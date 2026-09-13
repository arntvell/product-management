// Writing the master's SKU to Shopify.
//
// Why this exists, when aliases were supposed to make it unnecessary:
//
// An alias works between systems that join on ids. Sitoo and Shopify both do —
// Sitoo by product id, Shopify by ProductVariant and InventoryItem — so a
// differing SKU there is a naming inconsistency, recorded in
// VariantChannelRef.externalSku and harmless to stock.
//
// Pio, the central storage system, does not. Its export carries `sku` and an
// `ext_variant_id` that is byte-identical to it in all 3,692 rows: SKU IS the
// identity there, with no id to fall back to. An alias lives in Origio, and Pio
// never sees Origio — so where Shopify's SKU differs from the master's, central
// stock cannot reconcile against the webshop at all. Measured 2026-09-13:
// LIV-KR-JPN-DWN alone holds 298 units in Pio under the master's spelling while
// Shopify calls it LIV-KRI-DWN-*.
//
// So this is deliberately narrow: it renames LIVE Shopify variants to the SKU the
// master already holds, for variants where we have recorded that they differ. It
// creates nothing, touches no price, barcode, description or media.
//
// Note on the API: `sku` is not a field on ProductVariantsBulkInput. It moved
// under `inventoryItem`, which is consistent with what a SKU actually labels —
// the stock-keeping unit, not the listing. Verified by introspection against
// 2024-10.

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_VARIANTS_BULK_UPDATE_MUTATION } from "@/lib/shopify/mutations";
import { normalizeSku } from "@/lib/master/sku";
import { fetchShopifyVariants, type ShopifyVariantRow } from "./link";

export interface ShopifySkuPushOptions {
  dryRun?: boolean;
  /** Restrict to these Origio variant ids; omit for every recorded divergence. */
  variantIds?: string[];
  /** Restrict to colorways whose SKU is in this list — the usual scoping. */
  colorwaySkus?: string[];
  rows?: ShopifyVariantRow[];
}

export interface ShopifySkuPlan {
  writes: Array<{
    productGid: string;
    variantGid: string;
    from: string;
    to: string;
    colorwaySku: string;
  }>;
  /**
   * Refused: the SKU we would write is already on another LIVE Shopify variant.
   * Shopify does not enforce SKU uniqueness — it holds 150 repeated SKUs today —
   * so it would accept this silently and leave two live variants indistinguishable
   * to Pio, which is the exact failure this push exists to remove.
   */
  blockedLive: Array<{ from: string; to: string; heldBy: string }>;
  /**
   * Allowed, but noted: an ARCHIVED variant already holds the target. Harmless to
   * the linker, which only ever matches live rows, but a SKU search in Shopify
   * will return two results until the archived record is suffixed.
   */
  archivedHolder: Array<{ to: string; handle: string }>;
  /** Already correct. */
  unchanged: number;
  /** No Shopify link, so nothing to rename. */
  unlinked: number;
}

export interface ShopifySkuResult extends ShopifySkuPlan {
  applied: number;
  failures: Array<{ productGid: string; error: string }>;
  dryRun: boolean;
}

export async function planShopifySkuPush(
  opts: ShopifySkuPushOptions = {}
): Promise<ShopifySkuPlan> {
  const all = opts.rows ?? (await fetchShopifyVariants());
  const live = all.filter((r) => !r.archived);
  const archived = all.filter((r) => r.archived);

  const byGid = new Map(live.map((r) => [r.variantGid, r]));
  const liveBySku = new Map<string, ShopifyVariantRow>();
  for (const r of live) if (r.sku) liveBySku.set(normalizeSku(r.sku), r);
  const archivedBySku = new Map<string, ShopifyVariantRow>();
  for (const r of archived) if (r.sku) archivedBySku.set(normalizeSku(r.sku), r);

  const variants = await prisma.variant.findMany({
    where: {
      ...(opts.variantIds?.length ? { id: { in: opts.variantIds } } : {}),
      channelRefs: { some: { channel: "SHOPIFY", externalSku: { not: null } } },
      // Both colorway conditions go in ONE object. Spreading a `colorway` key and
      // then writing `colorway:` again silently drops the first — the scoping
      // filter was discarded and a dry run "scoped" to three families returned
      // four.
      colorway: {
        archived: false,
        ...(opts.colorwaySkus?.length ? { colorwaySku: { in: opts.colorwaySkus } } : {}),
      },
    },
    select: {
      id: true,
      variantSku: true,
      colorway: { select: { colorwaySku: true } },
      channelRefs: {
        where: { channel: "SHOPIFY" },
        select: { externalId: true, externalSku: true },
      },
    },
  });

  const plan: ShopifySkuPlan = {
    writes: [],
    blockedLive: [],
    archivedHolder: [],
    unchanged: 0,
    unlinked: 0,
  };
  const seenArchived = new Set<string>();

  for (const v of variants) {
    const ref = v.channelRefs[0];
    if (!ref) {
      plan.unlinked++;
      continue;
    }
    const row = byGid.get(ref.externalId);
    if (!row) {
      plan.unlinked++;
      continue;
    }
    const target = v.variantSku;
    if (row.sku && normalizeSku(row.sku) === normalizeSku(target)) {
      plan.unchanged++;
      continue;
    }

    // A live holder that is not this very row means two variants would answer to
    // one SKU. Pio joins on that string; refuse.
    const holder = liveBySku.get(normalizeSku(target));
    if (holder && holder.variantGid !== row.variantGid) {
      plan.blockedLive.push({
        from: row.sku ?? "(blank)",
        to: target,
        heldBy: holder.sku ?? holder.variantGid,
      });
      continue;
    }

    const arch = archivedBySku.get(normalizeSku(target));
    if (arch && !seenArchived.has(normalizeSku(target))) {
      seenArchived.add(normalizeSku(target));
      plan.archivedHolder.push({ to: target, handle: arch.productGid });
    }

    plan.writes.push({
      productGid: row.productGid,
      variantGid: row.variantGid,
      from: row.sku ?? "(blank)",
      to: target,
      colorwaySku: v.colorway.colorwaySku,
    });
  }
  return plan;
}

interface BulkUpdateResult {
  productVariantsBulkUpdate: {
    userErrors: { field: string[] | null; message: string; code: string | null }[];
  };
}

export async function pushSkusToShopify(
  opts: ShopifySkuPushOptions = {}
): Promise<ShopifySkuResult> {
  const plan = await planShopifySkuPush(opts);
  if (opts.dryRun) return { ...plan, applied: 0, failures: [], dryRun: true };

  const byProduct = new Map<string, typeof plan.writes>();
  for (const w of plan.writes) {
    (byProduct.get(w.productGid) ?? byProduct.set(w.productGid, []).get(w.productGid)!).push(w);
  }

  const failures: ShopifySkuResult["failures"] = [];
  let applied = 0;
  for (const [productGid, ws] of byProduct) {
    try {
      const data = await shopifyGraphQL<BulkUpdateResult>(
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        {
          productId: productGid,
          // sku lives on inventoryItem, not on the variant input.
          variants: ws.map((w) => ({ id: w.variantGid, inventoryItem: { sku: w.to } })),
        }
      );
      const errs = data.productVariantsBulkUpdate.userErrors;
      if (errs.length) {
        failures.push({ productGid, error: errs.map((e) => e.message).join("; ") });
        continue;
      }
      applied += ws.length;
    } catch (e) {
      failures.push({ productGid, error: (e as Error).message });
    }
  }
  return { ...plan, applied, failures, dryRun: false };
}


// ---------------------------------------------------------------------------
// Freeing a SKU held by an archived predecessor.
//
// When Shopify recreates a product it archives the old record and suffixes the
// handle (keri-japan-dawn -> keri-japan-dawn-1). The archived record KEEPS its
// SKU. So renaming the live variant onto the master's SKU leaves that string on
// two variants at once — 34 of them after the 2026-09-13 run.
//
// Our own linker is unaffected, since it only ever matches live rows. Pio is not:
// it joins on SKU text, and a lookup that returns a live and an archived variant
// is exactly the ambiguity the rename was meant to remove.
//
// Suffix rather than prefix, deliberately: the SKU keeps its stem, so it still
// sorts and searches next to the live one and still reads as the same garment.

const ARCHIVED_MARK = "--archived";

export interface ArchivedSuffixPlan {
  writes: Array<{ productGid: string; variantGid: string; from: string; to: string; handle: string }>;
  /** Archived SKUs that collide with nothing live — left alone. */
  untouched: number;
  /** Already suffixed by an earlier run. */
  alreadyMarked: number;
}

export interface ArchivedSuffixResult extends ArchivedSuffixPlan {
  applied: number;
  failures: Array<{ productGid: string; error: string }>;
  dryRun: boolean;
}

export async function planArchivedSkuSuffix(
  opts: { rows?: ShopifyVariantRow[]; skuPrefixes?: string[] } = {}
): Promise<ArchivedSuffixPlan> {
  const all = opts.rows ?? (await fetchShopifyVariants());
  const liveSkus = new Set<string>();
  for (const r of all) if (!r.archived && r.sku) liveSkus.add(normalizeSku(r.sku));

  const plan: ArchivedSuffixPlan = { writes: [], untouched: 0, alreadyMarked: 0 };
  for (const r of all) {
    if (!r.archived || !r.sku) continue;
    if (r.sku.includes(ARCHIVED_MARK)) {
      plan.alreadyMarked++;
      continue;
    }
    if (!liveSkus.has(normalizeSku(r.sku))) {
      plan.untouched++;
      continue;
    }
    if (
      opts.skuPrefixes?.length &&
      !opts.skuPrefixes.some((p) => normalizeSku(r.sku!).startsWith(normalizeSku(p)))
    ) {
      plan.untouched++;
      continue;
    }
    // The product gid tail keeps it unique even if one SKU has two archived
    // predecessors, which the handle suffix alone would not.
    const tail = r.productGid.split("/").pop() ?? "x";
    plan.writes.push({
      productGid: r.productGid,
      variantGid: r.variantGid,
      from: r.sku,
      to: `${r.sku}${ARCHIVED_MARK}-${tail.slice(-6)}`,
      handle: r.productGid,
    });
  }
  return plan;
}

export async function suffixArchivedSkus(
  opts: { dryRun?: boolean; rows?: ShopifyVariantRow[]; skuPrefixes?: string[] } = {}
): Promise<ArchivedSuffixResult> {
  const plan = await planArchivedSkuSuffix(opts);
  if (opts.dryRun) return { ...plan, applied: 0, failures: [], dryRun: true };

  const byProduct = new Map<string, typeof plan.writes>();
  for (const w of plan.writes) {
    (byProduct.get(w.productGid) ?? byProduct.set(w.productGid, []).get(w.productGid)!).push(w);
  }
  const failures: ArchivedSuffixResult["failures"] = [];
  let applied = 0;
  for (const [productGid, ws] of byProduct) {
    try {
      const data = await shopifyGraphQL<BulkUpdateResult>(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
        productId: productGid,
        variants: ws.map((w) => ({ id: w.variantGid, inventoryItem: { sku: w.to } })),
      });
      const errs = data.productVariantsBulkUpdate.userErrors;
      if (errs.length) {
        failures.push({ productGid, error: errs.map((e) => e.message).join("; ") });
        continue;
      }
      applied += ws.length;
    } catch (e) {
      failures.push({ productGid, error: (e as Error).message });
    }
  }
  return { ...plan, applied, failures, dryRun: false };
}
