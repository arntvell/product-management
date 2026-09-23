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
import { lockedFields } from "@/lib/master/provenance";
import {
  barcodeKey,
  channelNeedsBarcode,
  cleanBarcode,
  isInternalRange,
} from "@/lib/master/barcode";
import { normalizeSku } from "@/lib/master/sku";
import { listProducts, updateBarcode, type SitooProduct } from "./client";

export interface SitooPushOptions {
  dryRun?: boolean;
  /** Restrict to these variant ids; omit for every linked variant that differs. */
  variantIds?: string[];
  /** Which Sitoo. Defaults to SITOO_TARGET, else production. */
  target?: import("./client").SitooTarget;
  /**
   * Sitoo's current state. Supply it to avoid a re-fetch, or leave it out and
   * the plan reads it live.
   *
   * This must be Sitoo's *actual* barcode, not the master's record of what it
   * last wrote. The rotation is only detectable against live state, and it is
   * worst on the very first run — when the master has no push history at all.
   */
  products?: SitooProduct[];
  /**
   * The barcode the master is ABOUT to hold, by variant id. Lets a preview plan
   * the channel write before the master changes; the stored value is used for
   * any variant not in the map.
   */
  targets?: Map<string, string>;
}

export interface SitooPushPlan {
  /** Products whose current barcode is another product's target — unwound first. */
  unwind: Array<{ productId: number; variantSku: string; current: string }>;
  /** The corrections themselves. */
  writes: Array<{ productId: number; variantSku: string; from: string | null; to: string }>;
  /** Linked variants whose barcode already agrees. */
  unchanged: number;
  /**
   * Writes refused because Sitoo's current code is a store-printed label and
   * the master's is not. See isInternalRange.
   */
  storeLabel: Array<{ productId: number; variantSku: string; keeping: string; wouldWrite: string }>;
  /** Writes refused because the barcode field is locked — a disputed value. */
  locked: Array<{ variantSku: string; authority: string | null }>;
  /**
   * Writes refused because the product at that id is not the garment we think.
   *
   * The link was made against production, and the sandbox is a different account
   * whose ids are unrelated — so a production id sent there addresses some other
   * product. The same check also catches a link that has gone stale.
   */
  wrongProduct: Array<{ variantSku: string; productId: number; theirSku: string | null }>;
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
      ...(opts.targets ? {} : { barcode: { not: null } }),
    },
    select: {
      id: true,
      variantSku: true,
      barcode: true,
      channelRefs: {
        where: { channel: "SITOO" },
        select: { externalId: true, externalSku: true },
      },
    },
  });

  const writes: SitooPushPlan["writes"] = [];
  const storeLabel: SitooPushPlan["storeLabel"] = [];
  const locked: SitooPushPlan["locked"] = [];
  const wrongProduct: SitooPushPlan["wrongProduct"] = [];
  let unchanged = 0;
  let unlinked = 0;

  const live = opts.products ?? (await listProducts(opts.target));
  const skuById = new Map<number, string | null>(live.map((p) => [p.productid, p.sku ?? null]));
  const lockedByVariant = await lockedFields(
    "variant",
    variants.map((v) => v.id)
  );
  const currentById = new Map<number, string | null>(
    live.map((p) => [p.productid, cleanBarcode(p.barcode)])
  );

  for (const v of variants) {
    const ref = v.channelRefs[0];
    if (!ref) {
      unlinked++;
      continue;
    }
    // The master's own spelling, never re-spelled — see master/barcode.ts.
    const target = cleanBarcode(opts.targets?.get(v.id) ?? v.barcode);
    if (!target) continue;
    const productId = Number(ref.externalId);

    // Confirm the id still addresses this garment before touching it. A barcode
    // written to the wrong product is a scan that rings up the wrong thing.
    const theirSku = skuById.get(productId) ?? null;
    if (!theirSku || normalizeSku(theirSku) !== normalizeSku(v.variantSku)) {
      const aliasOk = ref.externalSku && normalizeSku(ref.externalSku) === normalizeSku(theirSku ?? "");
      if (!aliasOk) {
        wrongProduct.push({ variantSku: v.variantSku, productId, theirSku });
        continue;
      }
    }

    const have = currentById.get(productId) ?? null;
    if (!channelNeedsBarcode(have, target)) {
      unchanged++;
      continue;
    }
    if (lockedByVariant.get(v.id)?.has("barcode")) {
      locked.push({ variantSku: v.variantSku, authority: null });
      continue;
    }
    // Never replace a code that scans with one that merely identifies.
    if (have && isInternalRange(have) && !isInternalRange(target)) {
      storeLabel.push({
        productId,
        variantSku: v.variantSku,
        keeping: have,
        wouldWrite: target,
      });
      continue;
    }
    writes.push({ productId, variantSku: v.variantSku, from: have, to: target });
  }

  // A product must be unwound when the code it currently holds is the target of
  // some *other* product in this batch. Nulling it first frees the value.
  // By identity: `0884…` on one product blocks `884…` on another all the same.
  const targets = new Set(writes.map((w) => barcodeKey(w.to)));
  const unwind: SitooPushPlan["unwind"] = [];
  for (const w of writes) {
    const fromKey = barcodeKey(w.from);
    if (fromKey && targets.has(fromKey) && fromKey !== barcodeKey(w.to)) {
      unwind.push({ productId: w.productId, variantSku: w.variantSku, current: w.from! });
    }
  }
  return { unwind, writes, unchanged, unlinked, storeLabel, locked, wrongProduct };
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
      await updateBarcode(u.productId, null, opts.target);
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
      await updateBarcode(w.productId, w.to, opts.target);
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
