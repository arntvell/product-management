// Shopify carry-over / external import (Phase 2, plan §5.5).
// Reuses the existing Shopify Admin client to pull products the master doesn't
// already have (matched by handle or variant SKU) and creates them as
// source=SHOPIFY_IMPORT in the CONTINUITY season. Products already present
// (e.g. Threadflow-synced) are skipped, so this never duplicates or clobbers.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { METAFIELD_NAMESPACE } from "@/lib/constants";

const IMPORT_QUERY = `
  query ImportProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          tags
          status
          featuredImage { url }
          metafields(first: 25, namespace: "${METAFIELD_NAMESPACE}") {
            edges { node { key value } }
          }
          variants(first: 100) {
            edges { node { id sku barcode price title } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface SPProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  featuredImage: { url: string } | null;
  metafields: { edges: { node: { key: string; value: string } }[] };
  variants: {
    edges: {
      node: {
        id: string;
        sku: string | null;
        barcode: string | null;
        price: string | null;
        title: string;
      };
    }[];
  };
}

interface QueryResult {
  products: {
    edges: { node: SPProduct }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

async function fetchAllShopifyProducts(filter?: string): Promise<SPProduct[]> {
  const all: SPProduct[] = [];
  let after: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const data: QueryResult = await shopifyGraphQL<QueryResult>(IMPORT_QUERY, {
      first: 100,
      after,
      query: filter ?? "NOT status:archived",
    });
    all.push(...data.products.edges.map((e) => e.node));
    hasNext = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }
  return all;
}

const METAFIELD_MAP: Record<string, string> = {
  short_description: "shortDescription",
  full_description: "fullDescription",
  details: "details",
  style_tagline: "styleTagline",
  style_name: "styleName",
};

function classify(
  products: SPProduct[],
  existingHandles: Set<string>,
  existingSkus: Set<string>
): { toImport: SPProduct[]; skipped: SPProduct[] } {
  const toImport: SPProduct[] = [];
  const skipped: SPProduct[] = [];
  for (const p of products) {
    const skus = p.variants.edges.map((v) => v.node.sku).filter(Boolean) as string[];
    const collides =
      existingHandles.has(p.handle) || skus.some((s) => existingSkus.has(s));
    if (collides) skipped.push(p);
    else toImport.push(p);
  }
  return { toImport, skipped };
}

export interface ImportPreview {
  total: number;
  toImport: number;
  skipped: number;
  byVendor: { vendor: string; count: number }[];
}

async function loadExisting(): Promise<{ handles: Set<string>; skus: Set<string> }> {
  const [colorways, variants] = await Promise.all([
    prisma.colorway.findMany({ select: { colorwaySku: true } }),
    prisma.variant.findMany({ select: { variantSku: true } }),
  ]);
  return {
    handles: new Set(colorways.map((c) => c.colorwaySku)),
    skus: new Set(variants.map((v) => v.variantSku)),
  };
}

export async function previewShopifyImport(
  filter?: string
): Promise<ImportPreview> {
  const [products, existing] = await Promise.all([
    fetchAllShopifyProducts(filter),
    loadExisting(),
  ]);
  const { toImport, skipped } = classify(products, existing.handles, existing.skus);
  const counts = new Map<string, number>();
  for (const p of toImport) counts.set(p.vendor, (counts.get(p.vendor) ?? 0) + 1);
  return {
    total: products.length,
    toImport: toImport.length,
    skipped: skipped.length,
    byVendor: [...counts.entries()]
      .map(([vendor, count]) => ({ vendor, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  brands: number;
}

export async function runShopifyImport(
  vendors?: string[],
  filter?: string
): Promise<ImportResult> {
  const [products, existing] = await Promise.all([
    fetchAllShopifyProducts(filter),
    loadExisting(),
  ]);
  const classified = classify(products, existing.handles, existing.skus);
  const skipped = classified.skipped;
  // Only import the explicitly selected vendors (the Shopify catalogue mixes in
  // vintage, fit-guide pages, and past-season Livid goods — never blanket-import).
  const vendorSet = vendors && vendors.length ? new Set(vendors) : null;
  const toImport = vendorSet
    ? classified.toImport.filter((p) => vendorSet.has(p.vendor))
    : [];
  if (toImport.length === 0) return { imported: 0, skipped: skipped.length, brands: 0 };

  // Brands (upsert by vendor name).
  const brandNames = [...new Set(toImport.map((p) => p.vendor).filter(Boolean))];
  const brandIdByName = new Map<string, string>();
  for (const name of brandNames) {
    const b = await prisma.brand.upsert({
      where: { name },
      create: { name, isLivid: name.toLowerCase().includes("livid") },
      update: {},
    });
    brandIdByName.set(name, b.id);
  }

  // CONTINUITY season.
  const season = await prisma.season.upsert({
    where: { code: "CONTINUITY" },
    create: { code: "CONTINUITY", name: "Continuity", kind: "CONTINUITY" },
    update: {},
  });

  // Build bulk create payloads with pre-assigned ids.
  const styleCreates: Array<Record<string, unknown>> = [];
  const colorwayCreates: Array<Record<string, unknown>> = [];
  const variantCreates: Array<Record<string, unknown>> = [];
  const entryCreates: Array<{ id: string; colorwayId: string; seasonId: string; approvedForProduction: boolean }> = [];
  const seasonVariantLinks: Array<{ seasonEntryId: string; variantId: string }> = [];
  const priceCreates: Array<Record<string, unknown>> = [];
  const imageCreates: Array<Record<string, unknown>> = [];
  const pubCreates: Array<Record<string, unknown>> = [];

  const usedSkus = new Set(existing.skus);

  for (const p of toImport) {
    const brandId = p.vendor ? brandIdByName.get(p.vendor) ?? null : null;
    const styleId = randomUUID();
    const colorwayId = randomUUID();
    const entryId = randomUUID();

    // Enrichment from custom.* metafields.
    const enrichment: Record<string, string> = {};
    let swatchHex: string | null = null;
    for (const { node } of p.metafields.edges) {
      if (node.key === "color_hex") swatchHex = node.value;
      const target = METAFIELD_MAP[node.key];
      if (target && node.value) enrichment[target] = node.value;
    }

    styleCreates.push({
      id: styleId,
      source: "SHOPIFY_IMPORT",
      styleSku: p.handle,
      styleName: p.title,
      category: p.productType || "Uncategorized",
      brandId,
    });
    colorwayCreates.push({
      id: colorwayId,
      source: "SHOPIFY_IMPORT",
      colorwaySku: p.handle,
      name: p.title,
      styleId,
      brandId,
      status: p.status,
      tags: p.tags,
      vendor: p.vendor || null,
      productType: p.productType || null,
      swatchHex,
      ...enrichment,
    });
    entryCreates.push({
      id: entryId,
      colorwayId,
      seasonId: season.id,
      approvedForProduction: true,
    });

    let firstPrice: string | null = null;
    for (const { node: v } of p.variants.edges) {
      if (!v.sku || usedSkus.has(v.sku)) continue; // skip missing/dup SKUs
      usedSkus.add(v.sku);
      const variantId = randomUUID();
      variantCreates.push({
        id: variantId,
        colorwayId,
        variantSku: v.sku,
        barcode: v.barcode || null,
        sizeLabel: v.title || "OS",
        dim1: v.title || "OS",
      });
      seasonVariantLinks.push({ seasonEntryId: entryId, variantId });
      if (!firstPrice && v.price) firstPrice = v.price;
    }

    if (firstPrice) {
      priceCreates.push({
        seasonId: season.id,
        colorwayId,
        currency: "NOK",
        priceType: "MSRP",
        amount: firstPrice,
      });
    }
    if (p.featuredImage?.url) {
      imageCreates.push({
        seasonId: season.id,
        colorwayId,
        slot: "MAIN",
        url: p.featuredImage.url,
      });
    }
    pubCreates.push({
      colorwayId,
      channel: "SHOPIFY",
      published: true,
      externalId: p.id,
    });
  }

  // Execute in dependency order.
  await prisma.style.createMany({ data: styleCreates as never });
  await prisma.colorway.createMany({ data: colorwayCreates as never });
  await prisma.variant.createMany({ data: variantCreates as never });
  await prisma.seasonEntry.createMany({ data: entryCreates as never });
  if (seasonVariantLinks.length)
    await prisma.seasonVariant.createMany({
      data: seasonVariantLinks,
      skipDuplicates: true,
    });
  if (priceCreates.length)
    await prisma.price.createMany({ data: priceCreates as never });
  if (imageCreates.length)
    await prisma.seasonImage.createMany({ data: imageCreates as never });
  await prisma.channelPublication.createMany({ data: pubCreates as never });

  return {
    imported: toImport.length,
    skipped: skipped.length,
    brands: brandNames.length,
  };
}
