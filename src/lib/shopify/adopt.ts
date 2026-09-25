// Refusing to create a Shopify product that already exists, and recording the
// variant identity a create produces.
//
// THE BUG THIS EXISTS FOR
//
// `pushColorwayToShopify` calls productSet, then writes ChannelPublication. A
// crash, timeout or deploy between those two statements leaves Shopify holding
// a product the master has no record of. The retry reads
// `existing?.externalId == null`, concludes "create", and Shopify accepts it —
// silently suffixing the handle, because a handle collision is not an error
// there. Two live products, one garment, and the master points at neither.
//
// No batch or outbox table fixes this, because the missing fact does not live in
// our database: it lives in Shopify. The only trustworthy idempotency key is
// Shopify's own state, so we ask it before every create.
//
// THE SECOND THING
//
// VariantChannelRef(SHOPIFY) rows have only ever been written by the linker
// (link.ts). So a freshly created product carried no ProductVariant gid and no
// InventoryItem gid until somebody remembered to run the linker afterwards —
// and Loom's stock registry joins on the InventoryItem. "Somebody remembered"
// was a load-bearing step in a stock pipeline. recordShopifyVariantRefs moves
// that into the push itself.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { normalizeSku } from "@/lib/master/sku";
import { fetchShopifyVariants } from "./link";

/** How an existing product was found. Reported so a surprise is visible, not silent. */
export type AdoptionRoute =
  | "publication"
  | "variant-ref"
  | "sku-probe"
  | "handle-probe";

export interface Adoption {
  productGid: string;
  via: AdoptionRoute;
}

/**
 * Find the Shopify product for this colorway, if one already exists.
 *
 * Resolution is cheapest-first, and every step after the first is a repair of a
 * state the master should not be in:
 *
 *   publication   the normal path — we already know the product
 *   variant-ref   the linker writes refs (link.ts:248) and publications
 *                 (link.ts:264) in two statements; a failure between them
 *                 leaves refs without a publication
 *   sku-probe     the crash-after-productSet case above
 *   handle-probe  the same, for a product whose variants did not survive
 *
 * Returns null only when Shopify genuinely has nothing. The caller then creates.
 */
export async function adoptExistingShopifyProduct(
  colorwayId: string
): Promise<Adoption | null> {
  const cw = await prisma.colorway.findUnique({
    where: { id: colorwayId },
    select: {
      colorwaySku: true,
      publications: {
        where: { channel: "SHOPIFY" },
        select: { externalId: true },
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
  });
  if (!cw) return null;

  const published = cw.publications[0]?.externalId;
  if (published) return { productGid: published, via: "publication" };

  // A variant ref knows the ProductVariant, not the product, so resolve through
  // Shopify rather than guessing the parent from the gid.
  const refGid = cw.variants.flatMap((v) => v.channelRefs)[0]?.externalId;
  if (refGid) {
    const rows = await fetchShopifyVariants(`id:${gidTail(refGid)}`);
    const hit = rows.find((r) => r.variantGid === refGid);
    if (hit) {
      await backfillPublication(colorwayId, hit.productGid);
      return { productGid: hit.productGid, via: "variant-ref" };
    }
  }

  // Probe by the first variant SKU. Archived products are ignored: an archived
  // predecessor holding the SKU is exactly the case push-skus.ts suffixes away,
  // and adopting one would resurrect a listing we retired on purpose.
  const firstSku = cw.variants[0]?.variantSku;
  if (firstSku) {
    const rows = await fetchShopifyVariants(`sku:${quote(firstSku)}`);
    const live = rows.filter(
      (r) => !r.archived && r.sku && normalizeSku(r.sku) === normalizeSku(firstSku)
    );
    const products = [...new Set(live.map((r) => r.productGid))];
    if (products.length === 1) {
      await backfillPublication(colorwayId, products[0]);
      return { productGid: products[0], via: "sku-probe" };
    }
    if (products.length > 1) {
      // Already duplicated. Creating a third would make it worse, and picking
      // one at random would bind stock to an arbitrary listing.
      throw new Error(
        `Shopify holds ${products.length} live products for SKU ${firstSku} ` +
          `(${products.join(", ")}). Resolve the duplicate before pushing ${cw.colorwaySku}.`
      );
    }
  }

  // Last resort: the handle productSet would have minted (publish.ts:193).
  const handle = cw.colorwaySku.toLowerCase();
  const byHandle = await fetchShopifyVariants(`handle:${quote(handle)}`);
  const liveHandle = [...new Set(byHandle.filter((r) => !r.archived).map((r) => r.productGid))];
  if (liveHandle.length === 1) {
    await backfillPublication(colorwayId, liveHandle[0]);
    return { productGid: liveHandle[0], via: "handle-probe" };
  }

  return null;
}

export interface VariantRefResult {
  /** Rows written or refreshed. */
  linked: number;
  /** Of those, carrying an InventoryItem gid — what the Loom registry joins on. */
  inventoryLinked: number;
  /** SKUs Shopify returned that no master variant claims. */
  unmatched: string[];
  /** Master variants Shopify did not return. */
  missing: string[];
}

export interface PushedVariantNode {
  id: string;
  sku: string | null;
  inventoryItem?: { id: string } | null;
}

/**
 * Write VariantChannelRef(SHOPIFY) straight from what productSet returned.
 *
 * Matching is on normalizeSku, the same comparison link.ts:207 uses, and a raw
 * spelling that differs is recorded as an alias rather than overwritten — one
 * garment, two names, which is what externalSku is for.
 *
 * One statement per chunk. The per-row upsert form is a round trip each and
 * overran the transaction budget at 200 rows in the linker; there is no reason
 * to relearn that here.
 */
export async function recordShopifyVariantRefs(
  colorwayId: string,
  nodes: PushedVariantNode[]
): Promise<VariantRefResult> {
  const variants = await prisma.variant.findMany({
    where: { colorwayId },
    select: { id: true, variantSku: true },
  });
  const byNorm = new Map(variants.map((v) => [normalizeSku(v.variantSku), v]));

  const rows: Array<{
    variantId: string;
    externalId: string;
    externalSku: string | null;
    externalInventoryId: string | null;
  }> = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const n of nodes) {
    if (!n.sku) continue;
    const norm = normalizeSku(n.sku);
    const v = byNorm.get(norm);
    if (!v) {
      unmatched.push(n.sku);
      continue;
    }
    seen.add(v.id);
    rows.push({
      variantId: v.id,
      externalId: n.id,
      externalSku: n.sku !== v.variantSku ? n.sku : null,
      externalInventoryId: n.inventoryItem?.id ?? null,
    });
  }

  if (rows.length) {
    for (let i = 0; i < rows.length; i += 500) {
      const values = rows
        .slice(i, i + 500)
        .map(
          (r) =>
            Prisma.sql`(${randomUUID()}, ${r.variantId}, 'SHOPIFY'::"Channel", ${r.externalId}, ${r.externalSku}, ${r.externalInventoryId}, NOW(), 'ok')`
        );
      await prisma.$executeRaw`
        INSERT INTO "VariantChannelRef"
          ("id", "variantId", "channel", "externalId", "externalSku",
           "externalInventoryId", "lastPushedAt", "lastPushStatus")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("variantId", "channel") DO UPDATE SET
          "externalId" = EXCLUDED."externalId",
          "externalSku" = EXCLUDED."externalSku",
          -- Never blank an inventory id we already hold: productSet can omit
          -- the inventoryItem on a partial response, and the registry join
          -- depends on it. A null here means "no new information".
          "externalInventoryId" = COALESCE(
            EXCLUDED."externalInventoryId", "VariantChannelRef"."externalInventoryId"
          ),
          "lastPushedAt" = EXCLUDED."lastPushedAt",
          "lastPushStatus" = EXCLUDED."lastPushStatus"
      `;
    }
  }

  return {
    linked: rows.length,
    inventoryLinked: rows.filter((r) => r.externalInventoryId).length,
    unmatched,
    missing: variants.filter((v) => !seen.has(v.id)).map((v) => v.variantSku),
  };
}

/**
 * Record the product mapping found by a probe, without claiming a push.
 * `published` stays false — the master did not put it there, it found it.
 */
async function backfillPublication(colorwayId: string, productGid: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ChannelPublication"
      ("id", "colorwayId", "channel", "published", "externalId", "lastPushStatus")
    VALUES (${randomUUID()}, ${colorwayId}, 'SHOPIFY'::"Channel", false, ${productGid}, 'adopted')
    ON CONFLICT ("colorwayId", "channel") DO UPDATE SET
      "externalId" = EXCLUDED."externalId"
  `;
}

/** gid://shopify/ProductVariant/42591569969401 -> 42591569969401 */
function gidTail(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

/** Shopify search syntax: quote a value so a hyphenated SKU is one term. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
