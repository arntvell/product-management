// Writing corrected barcodes from the master to Shopify.
//
// The counterpart of src/lib/sitoo/push.ts, and deliberately the same shape:
// plan, review, apply. Scope is barcodes only — nothing is created, and no
// descriptions, prices or media are touched.
//
// The difference from Sitoo is that Shopify has no uniqueness constraint on
// barcode, so a rotation does not fail here — it silently succeeds and leaves two
// variants sharing a code. The master has to refuse that itself.
//
// Measured 2026-09-13: Shopify holds **2** barcodes on more than one LIVE variant
// (103 if archived variants are counted, which is where the 41 in the original
// version of this comment came from — it was a count across archived rows). Both
// live cases are two sizes of one style sharing a code:
//   3606621489698  EXT-PR-AVR-VLGR-7.5    | EXT-PR-AVR-VLGR-9.5
//   4582746159205  EXT-RTTO-..-RYL-BL-M   | EXT-RTTO-..-RYL-BL-S

import { prisma } from "@/lib/db";
import { lockedFields } from "@/lib/master/provenance";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_VARIANTS_BULK_UPDATE_MUTATION } from "@/lib/shopify/mutations";
import { canonical } from "@/lib/master/barcode";
import { fetchShopifyVariants, type ShopifyVariantRow } from "./link";

export interface ShopifyBarcodePushOptions {
  dryRun?: boolean;
  variantIds?: string[];
  /** Shopify's current state; fetched when omitted. */
  rows?: ShopifyVariantRow[];
}

export interface ShopifyBarcodePlan {
  writes: Array<{
    productGid: string;
    variantGid: string;
    variantSku: string;
    from: string | null;
    to: string;
  }>;
  unchanged: number;
  unlinked: number;
  /** Targets held by a Shopify variant this batch is not rewriting. */
  blocked: Array<{ variantSku: string; barcode: string; heldBy: string }>;
  /** Refused because the barcode field is locked — a value still in dispute. */
  locked: string[];
  missingProductLink: string[];
}

export interface ShopifyBarcodeResult extends ShopifyBarcodePlan {
  applied: number;
  failures: Array<{ productGid: string; error: string }>;
  dryRun: boolean;
}

export async function planShopifyBarcodePush(
  opts: ShopifyBarcodePushOptions = {}
): Promise<ShopifyBarcodePlan> {
  const live = (opts.rows ?? (await fetchShopifyVariants())).filter((r) => !r.archived);
  const byGid = new Map(live.map((r) => [r.variantGid, r]));

  const variants = await prisma.variant.findMany({
    where: {
      ...(opts.variantIds?.length ? { id: { in: opts.variantIds } } : {}),
      barcode: { not: null },
    },
    select: {
      id: true,
      variantSku: true,
      barcode: true,
      colorway: {
        select: {
          publications: {
            where: { channel: "SHOPIFY" },
            select: { externalId: true },
          },
        },
      },
      channelRefs: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
    },
  });

  const plan: ShopifyBarcodePlan = {
    writes: [],
    unchanged: 0,
    unlinked: 0,
    blocked: [],
    locked: [],
    missingProductLink: [],
  };

  // A locked barcode is one the master has not settled — the disputed
  // 7072536087* block, for instance. It must not reach any channel.
  const lockedByVariant = await lockedFields(
    "variant",
    variants.map((v) => v.id)
  );

  const candidates: Array<{
    variantGid: string;
    productGid: string;
    variantSku: string;
    from: string | null;
    to: string;
  }> = [];

  for (const v of variants) {
    const ref = v.channelRefs[0];
    if (!ref) {
      plan.unlinked++;
      continue;
    }
    if (lockedByVariant.get(v.id)?.has("barcode")) {
      plan.locked.push(v.variantSku);
      continue;
    }
    const target = canonical(v.barcode);
    if (!target) continue;

    const row = byGid.get(ref.externalId);
    const productGid = v.colorway.publications[0]?.externalId ?? row?.productGid;
    if (!productGid) {
      plan.missingProductLink.push(v.variantSku);
      continue;
    }
    const from = canonical(row?.barcode ?? null);
    if (from === target) {
      plan.unchanged++;
      continue;
    }
    candidates.push({
      variantGid: ref.externalId,
      productGid,
      variantSku: v.variantSku,
      from,
      to: target,
    });
  }

  // Shopify will not stop us putting one barcode on two variants, so refuse it
  // here. A target held by a live variant that this batch is not also rewriting
  // would create exactly the 41-way duplication the reconciliation found.
  const rewriting = new Set(candidates.map((c) => c.variantGid));
  const holders = new Map<string, ShopifyVariantRow>();
  for (const r of live) {
    const bc = canonical(r.barcode);
    if (bc && !rewriting.has(r.variantGid)) holders.set(bc, r);
  }
  for (const c of candidates) {
    const held = holders.get(c.to);
    if (held) {
      plan.blocked.push({
        variantSku: c.variantSku,
        barcode: c.to,
        heldBy: held.sku ?? held.variantGid,
      });
      continue;
    }
    plan.writes.push(c);
  }
  return plan;
}

interface BulkUpdateResult {
  productVariantsBulkUpdate: {
    userErrors: { field: string[] | null; message: string; code: string | null }[];
  };
}

export async function pushBarcodesToShopify(
  opts: ShopifyBarcodePushOptions = {}
): Promise<ShopifyBarcodeResult> {
  const plan = await planShopifyBarcodePush(opts);
  if (opts.dryRun) {
    return { ...plan, applied: 0, failures: [], dryRun: true };
  }

  // productVariantsBulkUpdate takes one product at a time.
  const byProduct = new Map<string, typeof plan.writes>();
  for (const w of plan.writes) {
    (byProduct.get(w.productGid) ?? byProduct.set(w.productGid, []).get(w.productGid)!).push(w);
  }

  const failures: ShopifyBarcodeResult["failures"] = [];
  let applied = 0;

  for (const [productGid, ws] of byProduct) {
    try {
      const data = await shopifyGraphQL<BulkUpdateResult>(
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        {
          productId: productGid,
          variants: ws.map((w) => ({ id: w.variantGid, barcode: w.to })),
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
