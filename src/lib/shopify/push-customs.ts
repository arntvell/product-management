// Backfilling customs onto Shopify's inventory items.
//
// WHY NOT JUST RE-PUSH
//
// pushColorwayToShopify writes customs now, but running it over the catalogue to
// backfill would be a serious mistake: productSet is DECLARATIVE. Re-pushing
// 4,584 colorways to change three customs fields would also rewrite their title,
// handle, vendor, product type, tags, status, metafields and media — replacing
// whatever merchants have done in Shopify admin since, on every product at once.
//
// So this is a targeted writer, modelled line-for-line on push-barcodes.ts:
// read the live state, plan the diff, apply through productVariantsBulkUpdate,
// which touches only the fields it is given.

import { shopifyGraphQL } from "./client";
import { PRODUCT_VARIANTS_BULK_UPDATE_MUTATION } from "./mutations";
import { prisma } from "@/lib/db";
import {
  resolveCustoms,
  isEmptyCustoms,
  type CustomsBlock,
} from "@/lib/master/customs-shopify";

const VARIANT_CUSTOMS_QUERY = `
  query VariantCustoms($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          sku
          product { id }
          inventoryItem {
            id
            harmonizedSystemCode
            countryCodeOfOrigin
            measurement { weight { unit value } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface VariantCustomsResult {
  productVariants: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        product: { id: string };
        inventoryItem: {
          id: string;
          harmonizedSystemCode: string | null;
          countryCodeOfOrigin: string | null;
          measurement: { weight: { unit: string; value: number } | null } | null;
        } | null;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export interface CustomsWrite {
  productGid: string;
  variantGid: string;
  variantSku: string;
  from: Partial<CustomsBlock>;
  to: CustomsBlock;
  fields: string[];
}

export interface ShopifyCustomsPlan {
  writes: CustomsWrite[];
  unchanged: number;
  /** Variants with no VariantChannelRef — nothing to write against. */
  unlinked: number;
  /** The master has nothing to say about these. */
  noCustomsData: number;
  /** Country spellings the master holds that are not a country code. */
  unresolvedCountry: Array<{ variantSku: string; raw: string }>;
  scanned: number;
}

export interface ShopifyCustomsResult extends ShopifyCustomsPlan {
  applied: number;
  failures: Array<{ productGid: string; error: string }>;
  dryRun: boolean;
}

export interface CustomsPushOptions {
  colorwayIds?: string[];
  /** Cap the plan. The rollout goes 1, then 50, then chunks of 250. */
  limit?: number;
  dryRun?: boolean;
}

/**
 * Work out what would change, without touching Shopify.
 *
 * Live state comes from Shopify rather than from our record of it: the point of
 * a backfill is the rows where the two disagree, so trusting our own copy would
 * plan exactly nothing.
 */
export async function planShopifyCustomsPush(
  opts: CustomsPushOptions = {}
): Promise<ShopifyCustomsPlan> {
  const colorways = await prisma.colorway.findMany({
    where: {
      kind: "MERCHANDISE",
      archived: false,
      ...(opts.colorwayIds?.length ? { id: { in: opts.colorwayIds } } : {}),
    },
    select: {
      id: true,
      colorwaySku: true,
      hsCodeOverride: true,
      customsDescriptionOverride: true,
      weightKgOverride: true,
      fiberCompositionOverride: true,
      countryOfOrigin: true,
      style: {
        select: { hsCode: true, customsDescription: true, weightKg: true, fiberComposition: true },
      },
      variants: {
        select: {
          variantSku: true,
          channelRefs: {
            where: { channel: "SHOPIFY" },
            select: { externalId: true },
          },
        },
      },
    },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const plan: ShopifyCustomsPlan = {
    writes: [],
    unchanged: 0,
    unlinked: 0,
    noCustomsData: 0,
    unresolvedCountry: [],
    scanned: 0,
  };

  // Index the master's intent by ProductVariant gid.
  const wanted = new Map<string, { sku: string; customs: CustomsBlock }>();
  for (const cw of colorways) {
    const customs = resolveCustoms(cw);
    for (const v of cw.variants) {
      plan.scanned++;
      const gid = v.channelRefs[0]?.externalId;
      if (!gid) {
        plan.unlinked++;
        continue;
      }
      if (customs.countryUnresolved)
        plan.unresolvedCountry.push({ variantSku: v.variantSku, raw: customs.countryUnresolved });
      if (isEmptyCustoms(customs)) {
        plan.noCustomsData++;
        continue;
      }
      wanted.set(gid, { sku: v.variantSku, customs });
    }
  }
  if (!wanted.size) return plan;

  // Read Shopify's current values, in pages.
  const live = new Map<
    string,
    { productGid: string; hs: string | null; country: string | null; weight: number | null }
  >();
  let after: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const data: VariantCustomsResult = await shopifyGraphQL<VariantCustomsResult>(
      VARIANT_CUSTOMS_QUERY,
      { first: 100, after, query: null }
    );
    for (const e of data.productVariants.edges) {
      if (!wanted.has(e.node.id)) continue;
      const inv = e.node.inventoryItem;
      live.set(e.node.id, {
        productGid: e.node.product.id,
        hs: inv?.harmonizedSystemCode ?? null,
        country: inv?.countryCodeOfOrigin ?? null,
        weight:
          inv?.measurement?.weight && inv.measurement.weight.unit === "KILOGRAMS"
            ? inv.measurement.weight.value
            : null,
      });
    }
    hasNext = data.productVariants.pageInfo.hasNextPage;
    after = data.productVariants.pageInfo.endCursor;
  }

  for (const [gid, want] of wanted) {
    const current = live.get(gid);
    if (!current) {
      plan.unlinked++;
      continue;
    }
    const fields: string[] = [];
    if (want.customs.hsCode && want.customs.hsCode !== current.hs) fields.push("hsCode");
    if (want.customs.countryCode && want.customs.countryCode !== current.country)
      fields.push("countryOfOrigin");
    if (want.customs.weightKg !== null && want.customs.weightKg !== current.weight)
      fields.push("weightKg");

    if (!fields.length) {
      plan.unchanged++;
      continue;
    }
    plan.writes.push({
      productGid: current.productGid,
      variantGid: gid,
      variantSku: want.sku,
      from: {
        hsCode: current.hs,
        countryCode: current.country,
        weightKg: current.weight,
      },
      to: want.customs,
      fields,
    });
  }

  return plan;
}

export async function pushCustomsToShopify(
  opts: CustomsPushOptions = {}
): Promise<ShopifyCustomsResult> {
  const plan = await planShopifyCustomsPush(opts);
  if (opts.dryRun) return { ...plan, applied: 0, failures: [], dryRun: true };

  const byProduct = new Map<string, CustomsWrite[]>();
  for (const w of plan.writes)
    (byProduct.get(w.productGid) ?? byProduct.set(w.productGid, []).get(w.productGid)!).push(w);

  const failures: ShopifyCustomsResult["failures"] = [];
  let applied = 0;

  for (const [productGid, ws] of byProduct) {
    try {
      const data = await shopifyGraphQL<{
        productVariantsBulkUpdate: { userErrors: { message: string }[] };
      }>(PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
        productId: productGid,
        variants: ws.map((w) => ({
          id: w.variantGid,
          // Only the fields that differ, and never a null: omission leaves
          // Shopify's value alone, which is the whole safety property here.
          inventoryItem: {
            ...(w.fields.includes("hsCode") ? { harmonizedSystemCode: w.to.hsCode! } : {}),
            ...(w.fields.includes("countryOfOrigin")
              ? { countryCodeOfOrigin: w.to.countryCode! }
              : {}),
            ...(w.fields.includes("weightKg")
              ? { measurement: { weight: { unit: "KILOGRAMS", value: w.to.weightKg! } } }
              : {}),
          },
        })),
      });
      const errs = data.productVariantsBulkUpdate?.userErrors ?? [];
      if (errs.length) {
        failures.push({ productGid, error: errs.map((e) => e.message).join("; ") });
        continue;
      }
      applied += ws.length;
    } catch (err) {
      failures.push({
        productGid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ...plan, applied, failures, dryRun: false };
}
