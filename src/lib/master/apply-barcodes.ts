// Applying barcode corrections to the master, with attribution.
//
// The 2026-09-11 run applied 122 corrections through generated SQL. It was
// correct, and it was undefendable: nothing in the database said the CFO's list
// had decided them. This is the same operation with the four things that were
// missing — canonical form, check-digit validation, a collision check, and a
// FieldOwner record naming the authority.
//
// Preview first, always. The apply is a bulk write to identity, which is the one
// field every other system joins on.

import { prisma } from "@/lib/db";
import { canonical, parseAllocation, rejectionReason } from "./barcode";
import { recordDecisions } from "./provenance";
import type { Source } from "@/generated/prisma/client";

export interface BarcodeCorrection {
  variantSku: string;
  barcode: string;
}

export interface ApplyBarcodesOptions {
  /** Who decided these, e.g. "cfo-list-2026-09-11" or "sitoo". */
  authority: string;
  /** What backs the decision — a file name, a majority count, "scanned in shop". */
  evidence?: string | null;
  /** The pipeline the values arrived through. */
  owner?: Source;
  dryRun?: boolean;
  /**
   * Overwrite a barcode the master already holds.
   *
   * Off by default. `Variant.barcode` is documented set-once, and most
   * corrections fill a blank; changing one that exists means a garment in a shop
   * may carry the old code, so it should be a deliberate act.
   */
  overwrite?: boolean;
}

export interface BarcodeApplyPlan {
  fill: Array<{ variantSku: string; to: string }>;
  change: Array<{ variantSku: string; from: string; to: string }>;
  unchanged: number;
  rejected: Array<{ variantSku: string; barcode: string; reason: string }>;
  collisions: Array<{ variantSku: string; barcode: string; heldBy: string }>;
  unknownSku: string[];
}

export interface BarcodeApplyResult extends BarcodeApplyPlan {
  applied: number;
  ledgerRecorded: number;
  dryRun: boolean;
}

export async function planBarcodeCorrections(
  corrections: BarcodeCorrection[],
  opts: Pick<ApplyBarcodesOptions, "overwrite">= {}
): Promise<BarcodeApplyPlan> {
  const plan: BarcodeApplyPlan = {
    fill: [],
    change: [],
    unchanged: 0,
    rejected: [],
    collisions: [],
    unknownSku: [],
  };

  const skus = [...new Set(corrections.map((c) => c.variantSku))];
  const variants = await prisma.variant.findMany({
    where: { variantSku: { in: skus } },
    select: { variantSku: true, barcode: true },
  });
  const bySku = new Map(variants.map((v) => [v.variantSku, v]));

  // Every barcode the master already holds, so a correction cannot be applied
  // that would put one code on two garments. This is the guard that stopped 84
  // bad writes during the reconciliation run.
  const held = await prisma.variant.findMany({
    where: { NOT: { barcode: null } },
    select: { variantSku: true, barcode: true },
  });
  const holder = new Map(held.map((v) => [v.barcode!, v.variantSku]));

  // Targets claimed within this batch itself.
  const claimed = new Map<string, string>();

  for (const c of corrections) {
    const target = canonical(c.barcode);
    if (!target) {
      plan.rejected.push({
        variantSku: c.variantSku,
        barcode: c.barcode,
        reason: rejectionReason(c.barcode) ?? "not a usable barcode",
      });
      continue;
    }
    const v = bySku.get(c.variantSku);
    if (!v) {
      plan.unknownSku.push(c.variantSku);
      continue;
    }
    const current = canonical(v.barcode);
    if (current === target) {
      plan.unchanged++;
      continue;
    }

    const heldBy = holder.get(target) ?? claimed.get(target);
    if (heldBy && heldBy !== c.variantSku) {
      plan.collisions.push({ variantSku: c.variantSku, barcode: target, heldBy });
      continue;
    }
    claimed.set(target, c.variantSku);

    if (current) {
      if (!opts.overwrite) {
        plan.rejected.push({
          variantSku: c.variantSku,
          barcode: target,
          reason: `already holds ${current} — pass overwrite to change a barcode that exists`,
        });
        continue;
      }
      plan.change.push({ variantSku: c.variantSku, from: current, to: target });
    } else {
      plan.fill.push({ variantSku: c.variantSku, to: target });
    }
  }
  return plan;
}

export async function applyBarcodeCorrections(
  corrections: BarcodeCorrection[],
  opts: ApplyBarcodesOptions
): Promise<BarcodeApplyResult> {
  const plan = await planBarcodeCorrections(corrections, { overwrite: opts.overwrite });
  if (opts.dryRun) {
    return { ...plan, applied: 0, ledgerRecorded: 0, dryRun: true };
  }

  const writes = [
    ...plan.fill.map((f) => ({ variantSku: f.variantSku, to: f.to })),
    ...plan.change.map((c) => ({ variantSku: c.variantSku, to: c.to })),
  ];
  if (!writes.length) {
    return { ...plan, applied: 0, ledgerRecorded: 0, dryRun: false };
  }

  const ids = new Map<string, string>();
  const rows = await prisma.variant.findMany({
    where: { variantSku: { in: writes.map((w) => w.variantSku) } },
    select: { id: true, variantSku: true },
  });
  for (const r of rows) ids.set(r.variantSku, r.id);

  let applied = 0;
  const CHUNK = 200;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((w) =>
        prisma.variant.update({ where: { variantSku: w.variantSku }, data: { barcode: w.to } })
      )
    );
    applied += chunk.length;
  }

  // Attribution: the whole point. Each corrected barcode now says who decided it.
  await recordDecisions(
    writes
      .filter((w) => ids.has(w.variantSku))
      .map((w) => ({
        entityType: "variant" as const,
        entityId: ids.get(w.variantSku)!,
        field: "barcode",
        owner: opts.owner ?? "MANUAL",
        authority: opts.authority,
        evidence: opts.evidence ?? null,
      }))
  );

  // Anything on Livid's own ranges joins the ledger, so allocation never
  // reissues a number a correction just introduced.
  const ledger = writes
    .filter((w) => parseAllocation(w.to))
    .map((w) => ({ barcode: w.to, sku: w.variantSku, authority: opts.authority }));
  const { recordIssued } = await import("./barcode");
  const { recorded } = await recordIssued(prisma, ledger);

  return { ...plan, applied, ledgerRecorded: recorded, dryRun: false };
}
