// Enrich Cin7-imported carry-over colorways with merchandising data from the
// live Shopify admin (tags, vendor, product-type). Matches master colorways to
// Shopify products by variant SKU (primary) then barcode (fallback), across ALL
// Shopify statuses (carry-overs are often archived/draft there).
//
// Non-destructive: tags are unioned (never lose one), vendor/product-type take
// Shopify's value only when it has one, and a field locked to MANUAL ownership
// is never touched.
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import type { Prisma, Source } from "@/generated/prisma/client";

const ENRICH_QUERY = `
  query EnrichProducts($cursor: String) {
    products(first: 200, after: $cursor, query: "status:active OR status:draft OR status:archived") {
      edges {
        node {
          title
          vendor
          productType
          tags
          variants(first: 100) { edges { node { sku barcode } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface ShopifyEnrichRec {
  vendor: string | null;
  productType: string | null;
  tags: string[];
}

interface EnrichQueryResult {
  products: {
    edges: {
      node: {
        title: string;
        vendor: string | null;
        productType: string | null;
        tags: string[];
        variants: { edges: { node: { sku: string | null; barcode: string | null } }[] };
      };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

// Index every Shopify variant SKU and barcode -> its product's enrich fields,
// plus a cleaned-name index (dropping ambiguous names that map to >1 product).
async function loadShopifyIndex(): Promise<{
  bySku: Map<string, ShopifyEnrichRec>;
  byBarcode: Map<string, ShopifyEnrichRec>;
  byName: Map<string, ShopifyEnrichRec>;
}> {
  const bySku = new Map<string, ShopifyEnrichRec>();
  const byBarcode = new Map<string, ShopifyEnrichRec>();
  const byName = new Map<string, ShopifyEnrichRec>();
  const nameAmbiguous = new Set<string>();
  let cursor: string | null = null;
  let hasNext = true;
  while (hasNext) {
    const data: EnrichQueryResult = await shopifyGraphQL<EnrichQueryResult>(ENRICH_QUERY, { cursor });
    for (const edge of data.products.edges) {
      const p = edge.node;
      const rec: ShopifyEnrichRec = { vendor: p.vendor, productType: p.productType, tags: p.tags ?? [] };
      for (const v of p.variants.edges) {
        if (v.node.sku) bySku.set(v.node.sku, rec);
        if (v.node.barcode) byBarcode.set(String(v.node.barcode), rec);
      }
      // Only tagged titles are useful, and only if unambiguous.
      const key = cleanNameKey(p.title);
      if (key && rec.tags.length) {
        if (byName.has(key)) nameAmbiguous.add(key);
        else byName.set(key, rec);
      }
    }
    hasNext = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }
  for (const k of nameAmbiguous) byName.delete(k);
  return { bySku, byBarcode, byName };
}

interface Cin7Row {
  id: string;
  name: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  variants: { variantSku: string; barcode: string | null }[];
}

// Normalize a product name for a last-resort match: drop trailing size tokens
// ("Keri Japan Gravel, 3432*" / "Barnes ... 31/32" / "34 34") and punctuation,
// so a Cin7 colorway name lines up with the Shopify product title. Cin7 and
// Shopify use different SKU schemes for legacy items (JP vs JPN, IMP- prefixes),
// so SKU/barcode alone misses products that DO exist in Shopify with tags.
function cleanNameKey(s: string): string {
  return (s || "")
    .replace(/\*/g, "")
    .replace(/,?\s*\d{2,4}([\/x]\d{2,4})?\s*$/i, "")
    .replace(/,?\s*(\d{2}\s+\d{2})\s*$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Which product sources to enrich. Default: Cin7 imports + Threadflow (skip
// purely MANUAL products). Threadflow matches are few today (most current-season
// products aren't in Shopify yet) but this picks them up as they appear.
const DEFAULT_ENRICH_SOURCES: Source[] = ["CIN7_IMPORT", "THREADFLOW"];

async function loadColorwaysForEnrich(
  sources: Source[] = DEFAULT_ENRICH_SOURCES
): Promise<Cin7Row[]> {
  const rows = await prisma.colorway.findMany({
    where: { source: { in: sources } },
    select: {
      id: true,
      name: true,
      vendor: true,
      productType: true,
      tags: true,
      variants: { select: { variantSku: true, barcode: true } },
    },
  });
  return rows;
}

// MANUAL-locked (colorway, field) pairs we must not overwrite.
async function loadManualLocks(colorwayIds: string[]): Promise<Map<string, Set<string>>> {
  const locks = new Map<string, Set<string>>();
  for (let i = 0; i < colorwayIds.length; i += 1000) {
    const chunk = colorwayIds.slice(i, i + 1000);
    const rows = await prisma.fieldOwner.findMany({
      where: { entityType: "colorway", entityId: { in: chunk }, owner: "MANUAL" },
      select: { entityId: true, field: true },
    });
    for (const r of rows) {
      const set = locks.get(r.entityId) ?? new Set<string>();
      set.add(r.field);
      locks.set(r.entityId, set);
    }
  }
  return locks;
}

function matchRec(
  row: Cin7Row,
  bySku: Map<string, ShopifyEnrichRec>,
  byBarcode: Map<string, ShopifyEnrichRec>,
  byName: Map<string, ShopifyEnrichRec>
): ShopifyEnrichRec | null {
  for (const v of row.variants) if (v.variantSku && bySku.has(v.variantSku)) return bySku.get(v.variantSku)!;
  for (const v of row.variants) if (v.barcode && byBarcode.has(String(v.barcode))) return byBarcode.get(String(v.barcode))!;
  const nameKey = cleanNameKey(row.name); // last resort (legacy SKU schemes differ)
  if (nameKey && byName.has(nameKey)) return byName.get(nameKey)!;
  return null;
}

// Compute the update for one colorway (null if nothing changes).
function planUpdate(
  row: Cin7Row,
  rec: ShopifyEnrichRec,
  locked: Set<string>
): { tags?: string[]; vendor?: string; productType?: string } | null {
  const update: { tags?: string[]; vendor?: string; productType?: string } = {};

  if (!locked.has("tags") && rec.tags.length) {
    const merged = [...new Set([...row.tags, ...rec.tags])];
    if (merged.length !== row.tags.length) update.tags = merged; // only if it adds
  }
  if (!locked.has("vendor") && rec.vendor && rec.vendor !== row.vendor) {
    update.vendor = rec.vendor; // Shopify wins
  }
  if (!locked.has("productType") && rec.productType && rec.productType !== row.productType) {
    update.productType = rec.productType; // Shopify wins
  }
  return Object.keys(update).length ? update : null;
}

export interface EnrichPreview {
  colorwaysConsidered: number;
  matched: number;
  unmatched: number;
  wouldSetTags: number;
  wouldSetVendor: number;
  wouldSetProductType: number;
}

export async function previewShopifyEnrichment(): Promise<EnrichPreview> {
  const [{ bySku, byBarcode, byName }, rows] = await Promise.all([loadShopifyIndex(), loadColorwaysForEnrich()]);
  const locks = await loadManualLocks(rows.map((r) => r.id));

  let matched = 0, wTags = 0, wVendor = 0, wType = 0;
  for (const row of rows) {
    const rec = matchRec(row, bySku, byBarcode, byName);
    if (!rec) continue;
    matched++;
    const u = planUpdate(row, rec, locks.get(row.id) ?? new Set());
    if (!u) continue;
    if (u.tags) wTags++;
    if (u.vendor) wVendor++;
    if (u.productType) wType++;
  }
  return {
    colorwaysConsidered: rows.length,
    matched,
    unmatched: rows.length - matched,
    wouldSetTags: wTags,
    wouldSetVendor: wVendor,
    wouldSetProductType: wType,
  };
}

export interface EnrichResult {
  matched: number;
  updated: number;
  setTags: number;
  setVendor: number;
  setProductType: number;
  syncRunId: string;
}

export async function runShopifyEnrichment(): Promise<EnrichResult> {
  const run = await prisma.syncRun.create({
    data: { source: "shopify-enrich", mode: "cin7-identification", status: "running" },
  });
  try {
    const [{ bySku, byBarcode, byName }, rows] = await Promise.all([loadShopifyIndex(), loadColorwaysForEnrich()]);
    const locks = await loadManualLocks(rows.map((r) => r.id));

    let matched = 0, updated = 0, setTags = 0, setVendor = 0, setProductType = 0;
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const CONCURRENCY = 15;
    const flush = async () => {
      for (let i = 0; i < ops.length; i += CONCURRENCY) await Promise.all(ops.slice(i, i + CONCURRENCY));
      ops.length = 0;
    };

    for (const row of rows) {
      const rec = matchRec(row, bySku, byBarcode, byName);
      if (!rec) continue;
      matched++;
      const u = planUpdate(row, rec, locks.get(row.id) ?? new Set());
      if (!u) continue;
      if (u.tags) setTags++;
      if (u.vendor) setVendor++;
      if (u.productType) setProductType++;
      ops.push(prisma.colorway.update({ where: { id: row.id }, data: u }));
      updated++;
      if (ops.length >= 300) await flush();
    }
    await flush();

    const result: EnrichResult = { matched, updated, setTags, setVendor, setProductType, syncRunId: run.id };
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "ok", counts: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        errors: [err instanceof Error ? err.message : "unknown"] as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
