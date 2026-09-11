// Linking Origio variants to the Sitoo products that already represent them.
//
// The first push must never create. Sitoo holds 14,714 products and Origio will
// hold roughly 10,000 after the backfill; they are overwhelmingly the same
// garments under the same SKUs. Creating rather than matching would double the
// POS catalogue, which is the sort of mistake that is discovered at a till.

import { prisma } from "@/lib/db";
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
      channelRefs: { where: { channel: "SITOO" }, select: { id: true } },
    },
  });

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
  };
  const writes: Array<{ variantId: string; externalId: string }> = [];
  const matchedProductIds = new Set<number>();

  for (const v of variants) {
    if (v.channelRefs.length) {
      result.alreadyLinked++;
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
    writes.push({ variantId: v.id, externalId: String(hits[0].productid) });
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
  return result;
}
