// Pulling the category and brand vocabularies out of every system.
//
// Read-only, and honest about what each channel can actually answer:
//
//   Sitoo    real category ids and a hierarchy, real manufacturer ids. The only
//            system with identity for either. Falls back to reading the same ids
//            off products if the reference endpoints are unavailable.
//   Shopify  `productType` and `vendor` are FREE STRINGS with no id and no
//            dedicated endpoint. They are aggregated from products, which is
//            needed anyway to count how many products carry each value.
//   Loom     no read endpoint exists at all — loom/client.ts is /upsert and
//            /jobs/{id}. The vocabulary is the 11 LOOM_CATEGORIES constants,
//            which we assert rather than fetch.
//   Origio   its own 76 category strings and its Brand rows.
//
// Nothing here writes to a channel or resolves a mapping. It fills the review
// queue; a person decides what maps to what.

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import {
  listCategories as sitooCategories,
  listManufacturers as sitooManufacturers,
  listProductRefs,
  resolveTarget,
  type SitooTarget,
} from "@/lib/sitoo/client";
import { LOOM_CATEGORIES } from "./loom-category";
import { normalizeBrandName } from "./brands";

export type RefSystem = "SHOPIFY" | "SITOO" | "LOOM" | "ORIGIO";

export interface PullCandidate {
  system: RefSystem;
  externalKey: string;
  externalName: string;
  externalPath?: string | null;
  externalId?: string | null;
  productCount: number;
}

export interface PullReport {
  categories: { found: number; bySystem: Record<string, number>; notes: string[] };
  brands: { found: number; bySystem: Record<string, number>; notes: string[] };
  dryRun: boolean;
}

export function normalizeCategoryKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function categorySlug(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "uncategorized"
  );
}

// ---------------------------------------------------------------------------
// Shopify — aggregated from products, because there is no other way
// ---------------------------------------------------------------------------

const SHOPIFY_FACETS_QUERY = `
  query ShopifyFacets($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges { node { id productType vendor } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface FacetResult {
  products: {
    edges: { node: { id: string; productType: string | null; vendor: string | null } }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function pullShopifyFacets(): Promise<{
  categories: PullCandidate[];
  brands: PullCandidate[];
  products: number;
}> {
  const types = new Map<string, { name: string; count: number }>();
  const vendors = new Map<string, { name: string; count: number }>();
  let after: string | null = null;
  let hasNext = true;
  let products = 0;

  while (hasNext) {
    const data: FacetResult = await shopifyGraphQL<FacetResult>(SHOPIFY_FACETS_QUERY, {
      first: 250,
      after,
    });
    for (const e of data.products.edges) {
      products++;
      const t = e.node.productType?.trim();
      if (t) {
        const k = normalizeCategoryKey(t);
        const hit = types.get(k) ?? { name: t, count: 0 };
        hit.count++;
        types.set(k, hit);
      }
      const v = e.node.vendor?.trim();
      if (v) {
        const k = normalizeBrandName(v);
        const hit = vendors.get(k) ?? { name: v, count: 0 };
        hit.count++;
        vendors.set(k, hit);
      }
    }
    hasNext = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;
  }

  return {
    products,
    categories: [...types].map(([key, v]) => ({
      system: "SHOPIFY" as const,
      externalKey: key,
      externalName: v.name,
      externalId: null, // Shopify productType has no id. Ever.
      productCount: v.count,
    })),
    brands: [...vendors].map(([key, v]) => ({
      system: "SHOPIFY" as const,
      externalKey: key,
      externalName: v.name,
      externalId: null, // vendor is a free string with no id
      productCount: v.count,
    })),
  };
}

// ---------------------------------------------------------------------------
// Sitoo — the only channel with real ids
// ---------------------------------------------------------------------------

export async function pullSitooFacets(
  target?: SitooTarget
): Promise<{ categories: PullCandidate[]; brands: PullCandidate[]; notes: string[] }> {
  // WHICH ACCOUNT answered has to be in the report. SITOO_TARGET defaults to
  // sandbox in local development, and the sandbox is a separate account (91624)
  // with 570 unrelated products — reporting its vocabulary as production's would
  // be a confident wrong answer about how much work there is.
  const resolved = resolveTarget(target);
  const notes: string[] = [`Sitoo account: ${resolved}.`];

  // STRICTLY SEQUENTIAL. Sitoo allows no concurrent requests — two in flight
  // returns `429: Too many connections`, which is exactly what a Promise.all
  // here produced the first time this ran. Every Sitoo reader and writer in this
  // codebase has to obey that, so none of them may be parallelised for speed.
  const cats = await sitooCategories(resolved);
  if (cats.note) notes.push(cats.note);
  const manus = await sitooManufacturers(resolved);
  if (manus.note) notes.push(manus.note);

  // Counts, and the fallback names, both come from the product list.
  let refs: Awaited<ReturnType<typeof listProductRefs>> = [];
  try {
    refs = await listProductRefs(resolved);
  } catch (err) {
    notes.push(
      `Could not read Sitoo products for counts: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`
    );
  }

  const catCounts = new Map<string, number>();
  const manuCounts = new Map<string, number>();
  for (const r of refs) {
    if (r.defaultcategoryid != null)
      catCounts.set(String(r.defaultcategoryid), (catCounts.get(String(r.defaultcategoryid)) ?? 0) + 1);
    if (r.manufacturerid != null)
      manuCounts.set(String(r.manufacturerid), (manuCounts.get(String(r.manufacturerid)) ?? 0) + 1);
  }

  const byId = new Map(cats.items.map((c) => [String(c.categoryid), c]));
  const categoryIds = new Set([...byId.keys(), ...catCounts.keys()]);
  const categories: PullCandidate[] = [...categoryIds].map((id) => {
    const c = byId.get(id);
    return {
      system: "SITOO" as const,
      externalKey: id, // the numeric id IS the canonical key here
      externalName: c?.title?.trim() || `Sitoo category ${id}`,
      externalPath: c ? pathFor(c.categoryid, byId) : null,
      externalId: id,
      productCount: catCounts.get(id) ?? 0,
    };
  });

  const manuById = new Map(manus.items.map((m) => [String(m.externalcompanyid), m]));
  const manuIds = new Set([...manuById.keys(), ...manuCounts.keys()]);
  const brands: PullCandidate[] = [...manuIds].map((id) => {
    const m = manuById.get(id);
    return {
      system: "SITOO" as const,
      externalKey: id,
      externalName: m?.name?.trim() || `Sitoo manufacturer ${id}`,
      externalId: id,
      productCount: manuCounts.get(id) ?? 0,
    };
  });

  if (!brands.length)
    notes.push(
      `Sitoo (${resolved}) returned no manufacturers and no product carries a ` +
        "manufacturerid, so there is nothing on that side to MATCH a brand to. " +
        "Brand identity in Sitoo would have to be created, not mapped."
    );

  return { categories, brands, notes };
}

function pathFor(
  id: number,
  byId: Map<string, { categoryid: number; title: string | null; categoryparentid?: number | null }>
): string {
  const parts: string[] = [];
  let cur = byId.get(String(id));
  const seen = new Set<number>();
  while (cur && !seen.has(cur.categoryid)) {
    seen.add(cur.categoryid);
    parts.unshift(cur.title?.trim() || String(cur.categoryid));
    cur = cur.categoryparentid ? byId.get(String(cur.categoryparentid)) : undefined;
  }
  return parts.join(" > ");
}

// ---------------------------------------------------------------------------
// Origio and Loom
// ---------------------------------------------------------------------------

export async function pullOrigioFacets(): Promise<{
  categories: PullCandidate[];
  brands: PullCandidate[];
}> {
  const [styleCats, colorwayTypes, brands] = await Promise.all([
    prisma.style.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.colorway.groupBy({ by: ["productType"], _count: { _all: true } }),
    prisma.brand.findMany({
      select: { name: true, _count: { select: { colorways: true } } },
    }),
  ]);

  const cats = new Map<string, { name: string; count: number }>();
  const add = (raw: string | null, n: number) => {
    const v = raw?.trim();
    if (!v) return;
    const k = normalizeCategoryKey(v);
    const hit = cats.get(k) ?? { name: v, count: 0 };
    hit.count += n;
    cats.set(k, hit);
  };
  for (const s of styleCats) add(s.category, s._count._all);
  for (const c of colorwayTypes) add(c.productType, c._count._all);

  return {
    categories: [...cats].map(([key, v]) => ({
      system: "ORIGIO" as const,
      externalKey: key,
      externalName: v.name,
      productCount: v.count,
    })),
    brands: brands.map((b) => ({
      system: "ORIGIO" as const,
      externalKey: normalizeBrandName(b.name),
      externalName: b.name,
      productCount: b._count.colorways,
    })),
  };
}

/**
 * Loom has no read endpoint — loom/client.ts exposes /upsert and /jobs/{id}.
 * The vocabulary is the constant we already send against, so it is asserted here
 * rather than fetched, and labelled as such.
 */
export function pullLoomCategories(): PullCandidate[] {
  return LOOM_CATEGORIES.map((name) => ({
    system: "LOOM" as const,
    externalKey: normalizeCategoryKey(name),
    externalName: name,
    productCount: 0,
  }));
}

// ---------------------------------------------------------------------------
// Persisting the queue
// ---------------------------------------------------------------------------

export async function pullAllReferences(
  opts: {
    dryRun?: boolean;
    skipShopify?: boolean;
    skipSitoo?: boolean;
    sitooTarget?: SitooTarget;
  } = {}
): Promise<PullReport> {
  const notesCat: string[] = [];
  const notesBrand: string[] = [];
  const categories: PullCandidate[] = [];
  const brands: PullCandidate[] = [];

  const origio = await pullOrigioFacets();
  categories.push(...origio.categories);
  brands.push(...origio.brands);
  categories.push(...pullLoomCategories());
  notesCat.push("Loom has no read endpoint; its 11 categories are asserted from LOOM_CATEGORIES.");

  if (!opts.skipShopify) {
    try {
      const s = await pullShopifyFacets();
      categories.push(...s.categories);
      brands.push(...s.brands);
      notesCat.push(
        `Shopify: ${s.categories.length} product types over ${s.products} products. No id exists — the string is the key.`
      );
      notesBrand.push(
        `Shopify: ${s.brands.length} vendors. Vendor is a free string with no id, so there is nothing to join on but the spelling.`
      );
    } catch (err) {
      const m = err instanceof Error ? err.message.slice(0, 200) : "unknown";
      notesCat.push(`Shopify pull failed: ${m}`);
      notesBrand.push(`Shopify pull failed: ${m}`);
    }
  }

  if (!opts.skipSitoo) {
    try {
      const s = await pullSitooFacets(opts.sitooTarget);
      categories.push(...s.categories);
      brands.push(...s.brands);
      notesCat.push(...s.notes);
    } catch (err) {
      const m = err instanceof Error ? err.message.slice(0, 200) : "unknown";
      notesCat.push(`Sitoo pull failed: ${m}`);
      notesBrand.push(`Sitoo pull failed: ${m}`);
    }
  }

  if (!opts.dryRun) {
    await upsertCandidates("category", categories);
    await upsertCandidates("brand", brands);
  }

  return {
    categories: { found: categories.length, bySystem: countBy(categories), notes: notesCat },
    brands: { found: brands.length, bySystem: countBy(brands), notes: notesBrand },
    dryRun: Boolean(opts.dryRun),
  };
}

async function upsertCandidates(
  kind: "category" | "brand",
  rows: PullCandidate[]
): Promise<void> {
  // Idempotent on (system, externalKey): a re-pull refreshes the count and the
  // last-seen stamp, and never disturbs a mapping a person has made.
  for (const r of rows) {
    if (kind === "category") {
      await prisma.categoryChannelMap.upsert({
        where: { system_externalKey: { system: r.system, externalKey: r.externalKey } },
        create: {
          system: r.system,
          externalKey: r.externalKey,
          externalName: r.externalName,
          externalPath: r.externalPath ?? null,
          productCount: r.productCount,
        },
        update: {
          externalName: r.externalName,
          externalPath: r.externalPath ?? null,
          productCount: r.productCount,
          lastSeenAt: new Date(),
        },
      });
    } else {
      if (r.system === "ORIGIO") continue; // Origio's brands ARE Brand rows
      await prisma.brandChannelRef.upsert({
        where: { system_externalKey: { system: r.system, externalKey: r.externalKey } },
        create: {
          system: r.system,
          externalKey: r.externalKey,
          externalName: r.externalName,
          externalId: r.externalId ?? null,
          productCount: r.productCount,
        },
        update: {
          externalName: r.externalName,
          externalId: r.externalId ?? null,
          productCount: r.productCount,
          lastSeenAt: new Date(),
        },
      });
    }
  }
}

function countBy(rows: PullCandidate[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.system] = (out[r.system] ?? 0) + 1;
  return out;
}
