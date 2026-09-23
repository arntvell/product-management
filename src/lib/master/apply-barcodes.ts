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
import { bulkUpdateByKey } from "@/lib/db-bulk";
import { barcodeKey, parseAllocation, rejectionReason, storedForm } from "./barcode";
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
  /**
   * Re-spell a barcode the variant already holds: `0884597234150` ->
   * `884597234150`. The same code either way, so without this a correction
   * that differs only by the leading zero is "unchanged".
   *
   * Off by default, because it is a migration when a bulk list does it: a feed
   * that spells a legacy row with its zero would strip it here and then in
   * every channel on the next push. The variant editor turns it on — a person
   * typing 12 digits over 13 means it.
   */
  reformat?: boolean;
}

export interface BarcodeApplyPlan {
  fill: Array<{ variantSku: string; to: string }>;
  change: Array<{ variantSku: string; from: string; to: string }>;
  /**
   * Variants whose current barcode is another variant's target within this same
   * batch. Their code is released before the targets are written.
   *
   * Without this a rotation cannot be applied at all: every row's target is held
   * by the row next to it, so each is refused as a collision and the set stays
   * wrong forever. Both known cases are rotations — the shifted Sitoo size runs,
   * and the Barnes/Hayes 7072536087* block.
   */
  unwind: Array<{ variantSku: string; releasing: string }>;
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
  opts: Pick<ApplyBarcodesOptions, "overwrite" | "reformat"> = {}
): Promise<BarcodeApplyPlan> {
  const plan: BarcodeApplyPlan = {
    fill: [],
    change: [],
    unwind: [],
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
  // Keyed by identity: `884…` and `0884…` are one code on one garment.
  const holder = new Map<string, string>();
  for (const v of held) {
    const key = barcodeKey(v.barcode);
    if (key) holder.set(key, v.variantSku);
  }

  // A holder can only give its code up if its OWN correction is written. The
  // first version counted every SKU in the batch, so a holder whose correction
  // was rejected (a mistyped check digit, say) still "released" its code: the
  // unwind cleared it, its neighbour took it, and the holder was left with no
  // barcode at all. Plan against the SKUs that would move, and repeat until
  // that set stops shrinking — dropping one mover can strand another.
  let movers = new Set(corrections.map((c) => c.variantSku));
  for (;;) {
    const next = planOnce(corrections, bySku, holder, movers, opts);
    const moved = new Set([...next.fill, ...next.change].map((w) => w.variantSku));
    if (moved.size === movers.size) {
      Object.assign(plan, next);
      return plan;
    }
    movers = moved;
  }
}

// Exported for scripts/check-barcode.ts: it is pure given the lookups, and it is
// where spelling vs identity is decided.
export function planOnce(
  corrections: BarcodeCorrection[],
  bySku: Map<string, { variantSku: string; barcode: string | null }>,
  holder: Map<string, string>,
  movers: Set<string>,
  opts: Pick<ApplyBarcodesOptions, "overwrite" | "reformat">
): BarcodeApplyPlan {
  const plan: BarcodeApplyPlan = {
    fill: [],
    change: [],
    unwind: [],
    unchanged: 0,
    rejected: [],
    collisions: [],
    unknownSku: [],
  };
  // Targets claimed within this batch itself.
  const claimed = new Map<string, string>();
  const unwinding = new Map<string, string>();

  for (const c of corrections) {
    // `key` answers "who holds it"; `target` is what gets written.
    const key = barcodeKey(c.barcode);
    const target = storedForm(c.barcode);
    if (!key || !target) {
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
    const current = v.barcode;
    if (current === target) {
      plan.unchanged++;
      continue;
    }
    // Same barcode, another spelling. Only a re-spell when asked for; the
    // collision checks below would pass it anyway, since it holds its own code.
    const respell = current !== null && barcodeKey(current) === key;
    if (respell && !opts.reformat) {
      plan.unchanged++;
      continue;
    }
    if (current && !respell && !opts.overwrite) {
      plan.rejected.push({
        variantSku: c.variantSku,
        barcode: target,
        reason: `already holds ${current} — pass overwrite to change a barcode that exists`,
      });
      continue;
    }
    if (!movers.has(c.variantSku)) {
      // Dropped in an earlier pass: the code it needed is not being released.
      const heldBy = holder.get(key) ?? claimed.get(key) ?? "another variant";
      plan.collisions.push({ variantSku: c.variantSku, barcode: target, heldBy });
      continue;
    }

    // Two corrections in one batch asking for the same code is always a clash.
    const rival = claimed.get(key);
    if (rival && rival !== c.variantSku) {
      plan.collisions.push({ variantSku: c.variantSku, barcode: target, heldBy: rival });
      continue;
    }
    // A code held by a variant this batch is also moving is a rotation: the
    // holder gives it up first. Held by anything else, it is a collision.
    const heldBy = holder.get(key);
    if (heldBy && heldBy !== c.variantSku) {
      if (!movers.has(heldBy)) {
        plan.collisions.push({ variantSku: c.variantSku, barcode: target, heldBy });
        continue;
      }
      unwinding.set(heldBy, target);
    }
    claimed.set(key, c.variantSku);

    if (current) plan.change.push({ variantSku: c.variantSku, from: current, to: target });
    else plan.fill.push({ variantSku: c.variantSku, to: target });
  }

  for (const [sku, releasing] of unwinding) plan.unwind.push({ variantSku: sku, releasing });
  return plan;
}

export async function applyBarcodeCorrections(
  corrections: BarcodeCorrection[],
  opts: ApplyBarcodesOptions
): Promise<BarcodeApplyResult> {
  const plan = await planBarcodeCorrections(corrections, {
    overwrite: opts.overwrite,
    reformat: opts.reformat,
  });
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

  // Phase 1 — release contested codes, so phase 2 cannot collide. Only matters
  // once the unique index is in place, but it is also the difference between a
  // rotation being applicable and being permanently refused.
  if (plan.unwind.length) {
    await bulkUpdateByKey(
      "Variant",
      "variantSku",
      "barcode",
      plan.unwind.map((u) => ({ key: u.variantSku, value: null }))
    );
  }

  // One statement per chunk. The per-row form inside a $transaction is a round
  // trip each and overran the 5 s budget at 175 rows — see src/lib/db-bulk.ts.
  const applied = await bulkUpdateByKey(
    "Variant",
    "variantSku",
    "barcode",
    writes.map((w) => ({ key: w.variantSku, value: w.to as string | null }))
  );

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
