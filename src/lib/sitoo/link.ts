// Linking Origio variants to the Sitoo products that already represent them.
//
// The first push must never create. Sitoo holds 14,714 products and Origio will
// hold roughly 10,000 after the backfill; they are overwhelmingly the same
// garments under the same SKUs. Creating rather than matching would double the
// POS catalogue, which is the sort of mistake that is discovered at a till.

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { canonical } from "@/lib/master/barcode";
import { normalizeSku } from "@/lib/master/sku";
import { listProducts, type SitooProduct } from "./client";

export interface LinkResult {
  linked: number;
  alreadyLinked: number;
  bySku: number;
  byBarcode: number;
  unmatchedVariants: number;
  unmatchedSitoo: number;
  ambiguous: Array<{ variantSku: string; productIds: number[] }>;
  /** Links where the channel calls the garment something else. */
  aliases: Array<{ variantSku: string; externalSku: string }>;
}

export interface LinkOptions {
  dryRun?: boolean;
  /** Supply products instead of fetching — used by tests and the snapshot path. */
  products?: SitooProduct[];
}

export async function linkSitooProducts(opts: LinkOptions = {}): Promise<LinkResult> {
  const products = opts.products ?? (await listProducts());

  const variants = await prisma.variant.findMany({
    select: {
      id: true,
      variantSku: true,
      barcode: true,
      channelRefs: {
        where: { channel: "SITOO" },
        select: { id: true, externalId: true, externalSku: true },
      },
    },
  });

  const byProductId = new Map<number, SitooProduct>(products.map((p) => [p.productid, p]));
  const bySitooSku = new Map<string, SitooProduct[]>();
  const bySitooBarcode = new Map<string, SitooProduct[]>();
  for (const p of products) {
    const sku = p.sku ? normalizeSku(p.sku) : null;
    if (sku) (bySitooSku.get(sku) ?? bySitooSku.set(sku, []).get(sku)!).push(p);
    const bc = canonical(p.barcode);
    if (bc) (bySitooBarcode.get(bc) ?? bySitooBarcode.set(bc, []).get(bc)!).push(p);
  }

  const result: LinkResult = {
    linked: 0,
    alreadyLinked: 0,
    bySku: 0,
    byBarcode: 0,
    unmatchedVariants: 0,
    unmatchedSitoo: 0,
    ambiguous: [],
    aliases: [],
  };
  const writes: Array<{ variantId: string; externalId: string; externalSku: string | null }> = [];
  const aliasUpdates: Array<{ refId: string; externalSku: string | null }> = [];
  const matchedProductIds = new Set<number>();

  for (const v of variants) {
    if (v.channelRefs.length) {
      result.alreadyLinked++;
      // Refresh the alias even for links that already exist: the column was
      // added after the first link run, and a channel can rename a product.
      const ref = v.channelRefs[0];
      const theirs = byProductId.get(Number(ref.externalId))?.sku ?? null;
      const want =
        theirs && normalizeSku(theirs) !== normalizeSku(v.variantSku) ? theirs : null;
      if (want !== ref.externalSku) aliasUpdates.push({ refId: ref.id, externalSku: want });
      if (want) result.aliases.push({ variantSku: v.variantSku, externalSku: want });
      continue;
    }
    // SKU first: it is the identifier both systems were built around, and
    // Origio's barcode coverage is thinner than Sitoo's.
    let hits = bySitooSku.get(normalizeSku(v.variantSku)) ?? [];
    let how: "sku" | "barcode" = "sku";
    if (!hits.length) {
      const bc = canonical(v.barcode);
      if (bc) {
        hits = bySitooBarcode.get(bc) ?? [];
        how = "barcode";
      }
    }
    if (!hits.length) {
      result.unmatchedVariants++;
      continue;
    }
    if (hits.length > 1) {
      result.ambiguous.push({ variantSku: v.variantSku, productIds: hits.map((h) => h.productid) });
      continue;
    }
    matchedProductIds.add(hits[0].productid);
    // Record the channel's own spelling when it differs — an alias, not a
    // second identity. Thrown away before, which is why cross-system SKU drift
    // was only ever visible in a reconciliation script.
    const theirSku = hits[0].sku ?? null;
    const alias =
      theirSku && normalizeSku(theirSku) !== normalizeSku(v.variantSku) ? theirSku : null;
    if (alias) result.aliases.push({ variantSku: v.variantSku, externalSku: alias });
    writes.push({ variantId: v.id, externalId: String(hits[0].productid), externalSku: alias });
    if (how === "sku") result.bySku++;
    else result.byBarcode++;
  }

  result.unmatchedSitoo = products.filter((p) => !matchedProductIds.has(p.productid)).length;
  result.linked = writes.length;

  if (!opts.dryRun && writes.length) {
    await prisma.variantChannelRef.createMany({
      data: writes.map((w) => ({ ...w, channel: "SITOO" as const })),
      skipDuplicates: true,
    });
  }
  if (!opts.dryRun && aliasUpdates.length) {
    await applyAliasUpdates(aliasUpdates);
  }
  return result;
}

/**
 * One UPDATE ... FROM (VALUES …) per chunk rather than a round trip per row.
 * The per-row form inside a $transaction overran the 5 s budget twice already.
 */
export async function applyAliasUpdates(
  updates: Array<{ refId: string; externalSku: string | null }>
): Promise<void> {
  for (let i = 0; i < updates.length; i += 500) {
    const rows = updates
      .slice(i, i + 500)
      .map((u) => Prisma.sql`(${u.refId}, ${u.externalSku})`);
    await prisma.$executeRaw`
      UPDATE "VariantChannelRef" r
      SET "externalSku" = v.sku
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, sku)
      WHERE r.id = v.id
    `;
  }
}
