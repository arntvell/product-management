// Writing identity from the master to Sitoo.
//
// Scope is deliberately narrow: this corrects barcodes on products that already
// exist in Sitoo. It does not create, and it does not push descriptions, prices
// or images. Sitoo is the POS — what it needs from the master right now is for a
// scan to resolve to the right garment.
//
// The hard case is not a wrong value, it is a *rotation*. Sitoo holds a shifted
// size run:
//
//   LIV-CN-BCHK-S   has 7072536068659   which belongs to M
//   LIV-CN-BCHK-M   has 7072536068666   which belongs to L
//   LIV-CN-BCHK-L   has 7000009888889   a placeholder
//
// Every size below XL carries the next size up's code, so scanning a Small rings
// up a Medium. Applied row by row each write collides with the row above it —
// Sitoo has zero duplicate barcodes across 14,714 products, so the field is
// almost certainly unique-constrained and the write is rejected. The set has to
// be unwound before it is rewritten.

import { prisma } from "@/lib/db";
import { canonical } from "@/lib/master/barcode";
import { listProducts, updateBarcode, type SitooProduct } from "./client";

export interface SitooPushOptions {
  dryRun?: boolean;
  /** Restrict to these variant ids; omit for every linked variant that differs. */
  variantIds?: string[];
  /**
   * Sitoo's current state. Supply it to avoid a re-fetch, or leave it out and
   * the plan reads it live.
   *
   * This must be Sitoo's *actual* barcode, not the master's record of what it
   * last wrote. The rotation is only detectable against live state, and it is
   * worst on the very first run — when the master has no push history at all.
   */
  products?: SitooProduct[];
}

export interface SitooPushPlan {
  /** Products whose current barcode is another product's target — unwound first. */
  unwind: Array<{ productId: number; variantSku: string; current: string }>;
  /** The corrections themselves. */
  writes: Array<{ productId: number; variantSku: string; from: string | null; to: string }>;
  /** Linked variants whose barcode already agrees. */
  unchanged: number;
  /** Variants with no Sitoo link — nothing to write against. */
  unlinked: number;
}

export interface SitooPushResult extends SitooPushPlan {
  applied: number;
  failures: Array<{ productId: number; variantSku: string; error: string }>;
  dryRun: boolean;
}

/**
 * Work out what would change, without touching Sitoo.
 *
 * Split out from the apply so the plan can be reviewed — the same
 * preview-then-write shape the carry-over dialog and resolve.py already use.
 */
export async function planSitooPush(opts: SitooPushOptions = {}): Promise<SitooPushPlan> {
  const variants = await prisma.variant.findMany({
    where: {
      ...(opts.variantIds?.length ? { id: { in: opts.variantIds } } : {}),
      barcode: { not: null },
    },
    select: {
      variantSku: true,
      barcode: true,
      channelRefs: {
        where: { channel: "SITOO" },
        select: { externalId: true },
      },
    },
  });

  const writes: SitooPushPlan["writes"] = [];
  let unchanged = 0;
  let unlinked = 0;

  const live = opts.products ?? (await listProducts());
  const currentById = new Map<number, string | null>(
    live.map((p) => [p.productid, canonical(p.barcode)])
  );

  for (const v of variants) {
    const ref = v.channelRefs[0];
    if (!ref) {
      unlinked++;
      continue;
    }
    const target = canonical(v.barcode);
    if (!target) continue;
    const productId = Number(ref.externalId);
    const have = currentById.get(productId) ?? null;
    if (have === target) {
      unchanged++;
      continue;
    }
    writes.push({ productId, variantSku: v.variantSku, from: have, to: target });
  }

  // A product must be unwound when the code it currently holds is the target of
  // some *other* product in this batch. Nulling it first frees the value.
  const targets = new Set(writes.map((w) => w.to));
  const unwind: SitooPushPlan["unwind"] = [];
  for (const w of writes) {
    if (w.from && targets.has(w.from) && w.from !== w.to) {
      unwind.push({ productId: w.productId, variantSku: w.variantSku, current: w.from });
    }
  }
  return { unwind, writes, unchanged, unlinked };
}

export async function pushBarcodesToSitoo(
  opts: SitooPushOptions = {}
): Promise<SitooPushResult> {
  const plan = await planSitooPush(opts);
  const failures: SitooPushResult["failures"] = [];
  let applied = 0;

  if (opts.dryRun) {
    return { ...plan, applied: 0, failures, dryRun: true };
  }

  // Phase 1 — release every contested code. Nothing is written to yet, so a
  // failure here stops the run with Sitoo unchanged except for some cleared
  // barcodes, which is recoverable: re-running rewrites them.
  for (const u of plan.unwind) {
    try {
      await updateBarcode(u.productId, null);
    } catch (e) {
      failures.push({
        productId: u.productId,
        variantSku: u.variantSku,
        error: `unwind failed: ${(e as Error).message}`,
      });
    }
  }
  if (failures.length) {
    return { ...plan, applied: 0, failures, dryRun: false };
  }

  // Phase 2 — write the targets. Every contested value is now free.
  for (const w of plan.writes) {
    try {
      await updateBarcode(w.productId, w.to);
      await prisma.variantChannelRef.updateMany({
        where: { channel: "SITOO", externalId: String(w.productId) },
        data: { lastPushedAt: new Date(), lastPushStatus: `barcode:${w.to}` },
      });
      applied++;
    } catch (e) {
      failures.push({
        productId: w.productId,
        variantSku: w.variantSku,
        error: (e as Error).message,
      });
    }
  }
  return { ...plan, applied, failures, dryRun: false };
}
