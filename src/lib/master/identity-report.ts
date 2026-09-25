// Which products are missing which channel id.
//
// This exists because the ids are load-bearing and invisible. Loom's stock
// registry joins on Shopify's InventoryItem gid; a variant without one
// reconciles by barcode or not at all. A colorway with no Sitoo product id
// cannot be corrected at the till. None of that shows up anywhere until stock
// disagrees, by which point it is an investigation rather than a gap.
//
// One raw statement rather than Prisma: the question is six conditional counts
// over 14,599 variants, and expressing it in Prisma means loading them.
// cutover-status.ts sets the precedent and explains the same reasoning.

import { prisma } from "@/lib/db";

export interface IdentityFilter {
  seasonCode?: string;
  brandId?: string;
  includeArchived?: boolean;
}

export interface IdentityGapCounts {
  colorways: number;
  variants: number;
  missingShopifyProduct: number;
  missingShopifyVariant: number;
  missingShopifyInventory: number;
  missingSitooProduct: number;
  missingLoomConfirmation: number;
  /**
   * Ids exist but were never SENT to Loom, or were sent before the ids were.
   *
   * SENT, never STORED. Loom answered `updated: 0` to all 355 identity rows
   * transmitted so far (WORK-DECK A2) — either the field name is not accepted or
   * it is stored and not counted. Until Loom answers, nothing may claim more
   * than that we sent it.
   */
  identityNotSentToLoom: number;
  /** Blocks the Loom registry outright: it sends barcoded variants only. */
  variantsWithoutBarcode: number;
}

export async function getIdentityGapCounts(
  f: IdentityFilter = {}
): Promise<IdentityGapCounts> {
  const rows = await prisma.$queryRaw<
    Array<Record<string, bigint>>
  >`
    SELECT
      COUNT(DISTINCT cw."id")                                          AS colorways,
      COUNT(v."id")                                                    AS variants,
      COUNT(DISTINCT cw."id") FILTER (WHERE sp."externalId" IS NULL)   AS missing_shopify_product,
      COUNT(v."id") FILTER (WHERE sv."id" IS NULL)                     AS missing_shopify_variant,
      COUNT(v."id") FILTER (WHERE sv."externalInventoryId" IS NULL)    AS missing_shopify_inventory,
      COUNT(v."id") FILTER (WHERE st."id" IS NULL)                     AS missing_sitoo_product,
      COUNT(DISTINCT cw."id") FILTER (WHERE lp."published" IS NOT TRUE) AS missing_loom_confirmation,
      COUNT(DISTINCT cw."id") FILTER (
        WHERE lp."loomIdentityPushedAt" IS NULL
           OR sv."lastPushedAt" > lp."loomIdentityPushedAt"
      )                                                                AS identity_not_sent,
      COUNT(v."id") FILTER (WHERE v."barcode" IS NULL)                 AS no_barcode
    FROM "Colorway" cw
    JOIN "Variant" v ON v."colorwayId" = cw."id"
    LEFT JOIN "ChannelPublication" sp
      ON sp."colorwayId" = cw."id" AND sp."channel" = 'SHOPIFY'
    LEFT JOIN "ChannelPublication" lp
      ON lp."colorwayId" = cw."id" AND lp."channel" = 'LOOM'
    LEFT JOIN "VariantChannelRef" sv
      ON sv."variantId" = v."id" AND sv."channel" = 'SHOPIFY'
    LEFT JOIN "VariantChannelRef" st
      ON st."variantId" = v."id" AND st."channel" = 'SITOO'
    WHERE cw."kind" = 'MERCHANDISE'
      AND (${f.includeArchived ?? false}::boolean OR cw."archived" = false)
      AND (${f.brandId ?? null}::text IS NULL OR cw."brandId" = ${f.brandId ?? null}::text)
  `;

  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    colorways: n("colorways"),
    variants: n("variants"),
    missingShopifyProduct: n("missing_shopify_product"),
    missingShopifyVariant: n("missing_shopify_variant"),
    missingShopifyInventory: n("missing_shopify_inventory"),
    missingSitooProduct: n("missing_sitoo_product"),
    missingLoomConfirmation: n("missing_loom_confirmation"),
    identityNotSentToLoom: n("identity_not_sent"),
    variantsWithoutBarcode: n("no_barcode"),
  };
}

export interface IdentityGapRow {
  colorwayId: string;
  colorwaySku: string;
  name: string;
  brand: string | null;
  shopifyProductGid: string | null;
  variants: number;
  withVariantGid: number;
  withInventoryGid: number;
  withSitooId: number;
  withBarcode: number;
  loomPublished: boolean;
  loomIdentitySentAt: string | null;
  gaps: string[];
}

export async function listIdentityGaps(
  f: IdentityFilter = {},
  page: { skip?: number; take?: number } = {}
): Promise<{ rows: IdentityGapRow[]; total: number }> {
  const where = {
    kind: "MERCHANDISE" as const,
    ...(f.includeArchived ? {} : { archived: false }),
    ...(f.brandId ? { brandId: f.brandId } : {}),
  };

  const [total, colorways] = await Promise.all([
    prisma.colorway.count({ where }),
    prisma.colorway.findMany({
      where,
      orderBy: { colorwaySku: "asc" },
      skip: page.skip ?? 0,
      take: page.take ?? 100,
      select: {
        id: true,
        colorwaySku: true,
        name: true,
        brand: { select: { name: true } },
        publications: { select: { channel: true, externalId: true, published: true, loomIdentityPushedAt: true } },
        variants: {
          select: {
            barcode: true,
            channelRefs: { select: { channel: true, externalId: true, externalInventoryId: true } },
          },
        },
      },
    }),
  ]);

  const rows = colorways.map((cw) => {
    const shopifyPub = cw.publications.find((p) => p.channel === "SHOPIFY");
    const loomPub = cw.publications.find((p) => p.channel === "LOOM");
    const withVariantGid = cw.variants.filter((v) =>
      v.channelRefs.some((r) => r.channel === "SHOPIFY")
    ).length;
    const withInventoryGid = cw.variants.filter((v) =>
      v.channelRefs.some((r) => r.channel === "SHOPIFY" && r.externalInventoryId)
    ).length;
    const withSitooId = cw.variants.filter((v) =>
      v.channelRefs.some((r) => r.channel === "SITOO")
    ).length;
    const withBarcode = cw.variants.filter((v) => v.barcode).length;

    const gaps: string[] = [];
    if (!shopifyPub?.externalId) gaps.push("shopify product");
    if (withVariantGid < cw.variants.length) gaps.push("variant ids");
    if (withInventoryGid < cw.variants.length) gaps.push("inventory items");
    if (withSitooId < cw.variants.length) gaps.push("sitoo ids");
    if (!loomPub?.published) gaps.push("loom");
    if (withBarcode < cw.variants.length) gaps.push("barcodes");

    return {
      colorwayId: cw.id,
      colorwaySku: cw.colorwaySku,
      name: cw.name,
      brand: cw.brand?.name ?? null,
      shopifyProductGid: shopifyPub?.externalId ?? null,
      variants: cw.variants.length,
      withVariantGid,
      withInventoryGid,
      withSitooId,
      withBarcode,
      loomPublished: Boolean(loomPub?.published),
      loomIdentitySentAt: loomPub?.loomIdentityPushedAt?.toISOString() ?? null,
      gaps,
    };
  });

  return { rows, total };
}
