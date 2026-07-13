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
          totalInventory
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
  totalInventory: number | null;
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

// Archived products are always excluded at the query level.
const DEFAULT_FILTER = "NOT status:archived";
// Tags that mark a product as on-sale (English + Norwegian). Matched as a
// substring because Livid's tags concatenate the marker, e.g. "SALE_FW25",
// "FW22SALE_U", "SALESS23_M", "Sale_Shoe_men". Sold-out sale items are excluded.
const SALE_TAG_RE = /sale|salg|outlet|clearance|tilbud/i;

function isSoldOutSale(p: SPProduct): boolean {
  const soldOut = (p.totalInventory ?? 0) <= 0;
  return soldOut && p.tags.some((t) => SALE_TAG_RE.test(t));
}

async function fetchAllShopifyProducts(filter?: string): Promise<SPProduct[]> {
  const all: SPProduct[] = [];
  let after: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const data: QueryResult = await shopifyGraphQL<QueryResult>(IMPORT_QUERY, {
      first: 100,
      after,
      query: filter ?? DEFAULT_FILTER,
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
): { toImport: SPProduct[]; skipped: SPProduct[]; excluded: SPProduct[] } {
  const toImport: SPProduct[] = [];
  const skipped: SPProduct[] = [];
  const excluded: SPProduct[] = [];
  for (const p of products) {
    if (isSoldOutSale(p)) {
      excluded.push(p); // sold-out sale item — not worth importing
      continue;
    }
    const skus = p.variants.edges.map((v) => v.node.sku).filter(Boolean) as string[];
    const collides =
      existingHandles.has(p.handle) || skus.some((s) => existingSkus.has(s));
    if (collides) skipped.push(p);
    else toImport.push(p);
  }
  return { toImport, skipped, excluded };
}

export interface ImportPreview {
  total: number;
  toImport: number;
  skipped: number;
  excluded: number;
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
  const { toImport, skipped, excluded } = classify(
    products,
    existing.handles,
    existing.skus
  );
  const counts = new Map<string, number>();
  for (const p of toImport) counts.set(p.vendor, (counts.get(p.vendor) ?? 0) + 1);
  return {
    total: products.length,
    toImport: toImport.length,
    skipped: skipped.length,
    excluded: excluded.length,
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

// ---------------------------------------------------------------------------
// Undo: remove previously-imported products
// ---------------------------------------------------------------------------

export async function listImportedVendors(): Promise<
  { vendor: string; count: number }[]
> {
  const rows = await prisma.colorway.findMany({
    where: { source: "SHOPIFY_IMPORT" },
    select: { vendor: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r.vendor ?? "(no vendor)";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count);
}

export async function removeImportedVendors(
  vendors: string[]
): Promise<{ removed: number }> {
  const colorways = await prisma.colorway.findMany({
    where: { source: "SHOPIFY_IMPORT", vendor: { in: vendors } },
    select: { id: true, styleId: true },
  });
  if (colorways.length === 0) return { removed: 0 };

  const styleIds = [...new Set(colorways.map((c) => c.styleId))];
  await prisma.colorway.deleteMany({
    where: { id: { in: colorways.map((c) => c.id) } },
  }); // cascades variants, prices, images, publications, entries

  // Drop any now-empty imported styles.
  const styles = await prisma.style.findMany({
    where: { id: { in: styleIds } },
    select: { id: true, _count: { select: { colorways: true } } },
  });
  const emptyStyleIds = styles.filter((s) => s._count.colorways === 0).map((s) => s.id);
  if (emptyStyleIds.length)
    await prisma.style.deleteMany({ where: { id: { in: emptyStyleIds } } });

  // Drop non-Livid brands left with no styles/colorways.
  const brands = await prisma.brand.findMany({
    where: { name: { in: vendors }, isLivid: false },
    select: { id: true, _count: { select: { styles: true, colorways: true } } },
  });
  const emptyBrandIds = brands
    .filter((b) => b._count.styles === 0 && b._count.colorways === 0)
    .map((b) => b.id);
  if (emptyBrandIds.length)
    await prisma.brand.deleteMany({ where: { id: { in: emptyBrandIds } } });

  return { removed: colorways.length };
}
