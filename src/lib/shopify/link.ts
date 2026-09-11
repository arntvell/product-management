// Linking Origio variants to the Shopify variants that already represent them.
//
// Shopify's product-level id is recorded on ChannelPublication, but the variant
// ids are not: push-shopify.ts reads them back out of the mutation response and
// drops them. That is fine for publishing a product and useless for stock,
// because inventory moves per variant. A scan in a shop resolves to one size of
// one colourway, and without a variant-level mapping there is nothing in the
// master to move it against.
//
// Matching is by SKU, then barcode. Both are normalised first — Origio holds 259
// mixed-case SKUs (LIV-Aino-M) and 44 with a slashed size (LIV-HYS-TP-28/34), so
// raw string equality silently misses them.

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { canonical } from "@/lib/master/barcode";
import { normalizeSku } from "@/lib/master/sku";

const VARIANTS_QUERY = `
  query LinkVariants($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          status
          variants(first: 100) {
            edges { node { id sku barcode } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface QueryResult {
  products: {
    edges: {
      node: {
        id: string;
        status: "ACTIVE" | "DRAFT" | "ARCHIVED";
        variants: { edges: { node: { id: string; sku: string | null; barcode: string | null } }[] };
      };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export interface ShopifyVariantRow {
  variantGid: string;
  productGid: string;
  sku: string | null;
  barcode: string | null;
  archived: boolean;
}

export async function fetchShopifyVariants(filter?: string): Promise<ShopifyVariantRow[]> {
  const out: ShopifyVariantRow[] = [];
  let after: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const data: QueryResult = await shopifyGraphQL<QueryResult>(VARIANTS_QUERY, {
      first: 100,
      after,
      query: filter ?? null,
    });
    for (const edge of data.products.edges) {
      const p = edge.node;
      for (const v of p.variants.edges) {
        out.push({
          variantGid: v.node.id,
          productGid: p.id,
          sku: v.node.sku,
          barcode: v.node.barcode,
          archived: p.status === "ARCHIVED",
        });
      }
    }
    hasNext = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }
  return out;
}

export interface ShopifyLinkResult {
  linked: number;
  alreadyLinked: number;
  bySku: number;
  byBarcode: number;
  unmatchedVariants: number;
  ambiguous: Array<{ variantSku: string; variantGids: string[] }>;
  skippedArchived: number;
}

export interface ShopifyLinkOptions {
  dryRun?: boolean;
  rows?: ShopifyVariantRow[];
}

export async function linkShopifyVariants(
  opts: ShopifyLinkOptions = {}
): Promise<ShopifyLinkResult> {
  const all = opts.rows ?? (await fetchShopifyVariants());

  // Archived products are history, not current identity. 7,523 Shopify SKUs
  // exist only on archived products; linking to one would point the master at a
  // record that cannot receive stock.
  const live = all.filter((r) => !r.archived);

  const bySku = new Map<string, ShopifyVariantRow[]>();
  const byBarcode = new Map<string, ShopifyVariantRow[]>();
  for (const r of live) {
    if (r.sku) {
      const k = normalizeSku(r.sku);
      (bySku.get(k) ?? bySku.set(k, []).get(k)!).push(r);
    }
    const bc = canonical(r.barcode);
    if (bc) (byBarcode.get(bc) ?? byBarcode.set(bc, []).get(bc)!).push(r);
  }

  const variants = await prisma.variant.findMany({
    select: {
      id: true,
      variantSku: true,
      barcode: true,
      channelRefs: { where: { channel: "SHOPIFY" }, select: { id: true } },
    },
  });

  const result: ShopifyLinkResult = {
    linked: 0,
    alreadyLinked: 0,
    bySku: 0,
    byBarcode: 0,
    unmatchedVariants: 0,
    ambiguous: [],
    skippedArchived: all.length - live.length,
  };
  const writes: Array<{ variantId: string; externalId: string }> = [];

  for (const v of variants) {
    if (v.channelRefs.length) {
      result.alreadyLinked++;
      continue;
    }
    let hits = bySku.get(normalizeSku(v.variantSku)) ?? [];
    let how: "sku" | "barcode" = "sku";
    if (!hits.length) {
      const bc = canonical(v.barcode);
      if (bc) {
        hits = byBarcode.get(bc) ?? [];
        how = "barcode";
      }
    }
    if (!hits.length) {
      result.unmatchedVariants++;
      continue;
    }
    // Shopify holds 41 barcodes on more than one variant and 150 repeated SKUs.
    // An ambiguous match is reported, never guessed — picking one would attach
    // stock to the wrong colourway.
    if (hits.length > 1) {
      result.ambiguous.push({
        variantSku: v.variantSku,
        variantGids: hits.map((h) => h.variantGid),
      });
      continue;
    }
    writes.push({ variantId: v.id, externalId: hits[0].variantGid });
    if (how === "sku") result.bySku++;
    else result.byBarcode++;
  }

  result.linked = writes.length;
  if (!opts.dryRun && writes.length) {
    await prisma.variantChannelRef.createMany({
      data: writes.map((w) => ({ ...w, channel: "SHOPIFY" as const })),
      skipDuplicates: true,
    });
  }
  return result;
}
