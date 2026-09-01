// Normalize casing of master colorway text fields (productType, vendor).
// Different sources (Cin7 derivation, Shopify manual entry) produce the same
// value in different cases ("Shirt"/"shirt", "Livid Men"/"Livid men"). We
// canonicalize each case-insensitive group to its MOST-FREQUENT existing form,
// so we adopt the real dominant convention rather than imposing Title Case.
// Re-runnable and non-destructive (skips MANUAL-locked fields).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type NormalizableField = "productType" | "vendor";

interface FieldPlan {
  field: NormalizableField;
  // old value -> canonical value (only entries that actually change)
  remap: Record<string, string>;
  affectedRows: number;
}

// Choose the canonical spelling for a case-insensitive group: highest count,
// tie-broken toward a capitalized first letter, then lexicographically.
function pickCanonical(variants: { value: string; count: number }[]): string {
  return [...variants].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const aCap = /^[A-Z]/.test(a.value) ? 0 : 1;
    const bCap = /^[A-Z]/.test(b.value) ? 0 : 1;
    if (aCap !== bCap) return aCap - bCap;
    return a.value.localeCompare(b.value);
  })[0].value;
}

async function planField(field: NormalizableField): Promise<FieldPlan> {
  const rows = await prisma.colorway.groupBy({
    by: [field],
    _count: { _all: true },
    where: { [field]: { not: null } },
  });

  const groups = new Map<string, { value: string; count: number }[]>();
  for (const r of rows) {
    const value = r[field] as string | null;
    if (!value || !value.trim()) continue;
    const key = value.toLowerCase().trim();
    const list = groups.get(key) ?? [];
    list.push({ value, count: r._count._all });
    groups.set(key, list);
  }

  const remap: Record<string, string> = {};
  let affectedRows = 0;
  for (const variants of groups.values()) {
    if (variants.length < 2) continue; // no casing conflict
    const canonical = pickCanonical(variants);
    for (const v of variants) {
      if (v.value !== canonical) {
        remap[v.value] = canonical;
        affectedRows += v.count;
      }
    }
  }
  return { field, remap, affectedRows };
}

export interface NormalizePreview {
  fields: {
    field: NormalizableField;
    changes: { from: string; to: string }[];
    affectedRows: number;
  }[];
}

export async function previewNormalize(
  fields: NormalizableField[] = ["productType", "vendor"]
): Promise<NormalizePreview> {
  const plans = await Promise.all(fields.map(planField));
  return {
    fields: plans.map((p) => ({
      field: p.field,
      changes: Object.entries(p.remap).map(([from, to]) => ({ from, to })),
      affectedRows: p.affectedRows,
    })),
  };
}

export interface NormalizeResult {
  updated: number;
  byField: { field: NormalizableField; updated: number }[];
  syncRunId: string;
}

export async function runNormalize(
  fields: NormalizableField[] = ["productType", "vendor"]
): Promise<NormalizeResult> {
  const run = await prisma.syncRun.create({
    data: { source: "normalize", mode: fields.join(","), status: "running" },
  });
  try {
    const plans = await Promise.all(fields.map(planField));

    // MANUAL-locked (colorway, field) pairs must not be rewritten.
    const lockRows = await prisma.fieldOwner.findMany({
      where: { entityType: "colorway", owner: "MANUAL", field: { in: fields } },
      select: { entityId: true, field: true },
    });
    const lockedByField = new Map<string, Set<string>>();
    for (const r of lockRows) {
      const set = lockedByField.get(r.field) ?? new Set<string>();
      set.add(r.entityId);
      lockedByField.set(r.field, set);
    }

    const byField: { field: NormalizableField; updated: number }[] = [];
    let updated = 0;
    for (const plan of plans) {
      let fieldUpdated = 0;
      const locked = lockedByField.get(plan.field) ?? new Set<string>();
      for (const [from, to] of Object.entries(plan.remap)) {
        const res = await prisma.colorway.updateMany({
          where: {
            [plan.field]: from,
            ...(locked.size ? { id: { notIn: [...locked] } } : {}),
          },
          data: { [plan.field]: to },
        });
        fieldUpdated += res.count;
      }
      byField.push({ field: plan.field, updated: fieldUpdated });
      updated += fieldUpdated;
    }

    const result: NormalizeResult = { updated, byField, syncRunId: run.id };
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "ok", counts: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        errors: [err instanceof Error ? err.message : "unknown"] as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
