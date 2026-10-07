// Finding the Shopify product a colorway already has, and recording the link.
//
// `sync-shopify-*.ts` match on the Shopify product GID the master recorded at
// push time. That is exact and cannot pair the wrong two products — but it only
// sees what has already been linked: 2,655 of 5,350 colorways. The other 2,685
// have no Shopify publication row at all, and some of them are in Shopify
// regardless. EXT-NRD-2CINM is one: Origio holds it as DRAFT with no Shopify
// link, Shopify holds gid://shopify/Product/8093810491641 as ARCHIVED, and every
// refresh passed silently over it because there was nothing to read from.
//
// So this runs first: sweep Shopify once, match on VARIANT SKU, and write the
// publication row. Afterwards the product is linked like any other and the
// status and field syncs see it without help.
//
// MATCHING IS SKU-ONLY, AND ONLY WHEN UNAMBIGUOUS.
//
//   Barcode is not used. `enrich-shopify.ts` falls back to it, but a barcode
//   search for a product this one found by SKU returned nothing, and the barcode
//   corpus has known rotations (sitoo/push.ts documents a shifted size run) — a
//   wrong link here writes a product id the master will then push to.
//
//   A SKU matching two Shopify products is left alone and reported. There is no
//   tie-break that is better than a person looking.
//
// It records a link; it never creates a product, in either system.

import { prisma } from "@/lib/db";
import { setShopifyBaseline } from "./shopify-update";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { normalizeSku } from "@/lib/master/sku";

const SWEEP = `
  query SweepProducts($cursor: String) {
    products(first: 100, after: $cursor, query: "status:active OR status:draft OR status:archived") {
      edges {
        node {
          id
          status
          variants(first: 100) { edges { node { sku } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export interface LinkCandidate {
  colorwayId: string;
  colorwaySku: string;
  productGid: string;
  shopifyStatus: string;
  /** Which of the colorway's variant SKUs matched. */
  via: string;
}

export interface LinkReport {
  unlinked: number;
  shopifyProducts: number;
  matched: LinkCandidate[];
  /** A SKU that hit more than one Shopify product — never guessed at. */
  ambiguous: string[];
  linked: number;
}

export async function linkShopifyProducts(
  opts: { apply?: boolean; colorwayIds?: string[] } = {}
): Promise<LinkReport> {
  const unlinked = await prisma.colorway.findMany({
    where: {
      ...(opts.colorwayIds?.length ? { id: { in: opts.colorwayIds } } : {}),
      publications: { none: { channel: "SHOPIFY", externalId: { not: null } } },
    },
    select: {
      id: true,
      colorwaySku: true,
      variants: { select: { variantSku: true } },
    },
  });

  // variant SKU -> colorway. A SKU belongs to one colorway by construction.
  const colorwayBySku = new Map<string, (typeof unlinked)[number]>();
  for (const cw of unlinked)
    for (const v of cw.variants) colorwayBySku.set(normalizeSku(v.variantSku), cw);

  // Sweep Shopify once. Per-SKU queries would be 2,685 round trips.
  const gidBySku = new Map<string, { gid: string; status: string }>();
  const ambiguousSkus = new Set<string>();
  let shopifyProducts = 0;
  let cursor: string | null = null;
  do {
    const d: {
      products: {
        edges: { node: { id: string; status: string; variants: { edges: { node: { sku: string | null } }[] } } }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await shopifyGraphQL(SWEEP, { cursor });
    for (const e of d.products.edges) {
      shopifyProducts++;
      for (const v of e.node.variants.edges) {
        const sku = v.node.sku?.trim();
        if (!sku) continue;
        const key = normalizeSku(sku);
        const seen = gidBySku.get(key);
        if (seen && seen.gid !== e.node.id) ambiguousSkus.add(key);
        else gidBySku.set(key, { gid: e.node.id, status: e.node.status });
      }
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (cursor);

  const matched: LinkCandidate[] = [];
  const ambiguous: string[] = [];
  const claimed = new Set<string>();
  for (const [sku, cw] of colorwayBySku) {
    if (claimed.has(cw.id)) continue;
    if (ambiguousSkus.has(sku)) {
      ambiguous.push(sku);
      continue;
    }
    const hit = gidBySku.get(sku);
    if (!hit) continue;
    claimed.add(cw.id);
    matched.push({
      colorwayId: cw.id,
      colorwaySku: cw.colorwaySku,
      productGid: hit.gid,
      shopifyStatus: hit.status,
      via: sku,
    });
  }

  let linked = 0;
  if (opts.apply) {
    for (const m of matched) {
      await prisma.channelPublication.upsert({
        where: { colorwayId_channel: { colorwayId: m.colorwayId, channel: "SHOPIFY" } },
        // `published` stays false: the link records that Shopify HOLDS this
        // product, which is not the same as the master having published it.
        create: { colorwayId: m.colorwayId, channel: "SHOPIFY", externalId: m.productGid },
        update: { externalId: m.productGid },
      });
      // From here a push is an update, which sends only what moves off the
      // baseline. Recorded now so differences that predate the link stay put.
      await setShopifyBaseline(m.colorwayId);
      linked++;
    }
  }

  return {
    unlinked: unlinked.length,
    shopifyProducts,
    matched,
    ambiguous: [...new Set(ambiguous)],
    linked,
  };
}
