// "Collections" view model. A product's collections are a union of three
// signals, because they come from different places:
//   - CORE           -> Colorway.isCore (permanent production line)
//   - SS27 / FW26 …  -> SeasonEntry (real seasons synced from Threadflow)
//   - SS26 / FW25 …  -> bare season-code tags (historical seasons we only know
//                       from Shopify tags; no earlier Threadflow data exists)
// This module turns that into a set of buckets with counts, plus the members of
// a selected bucket, so the UI can stay simple.
import { prisma } from "@/lib/db";
import { seasonSortValue } from "./classify";

export interface CollectionBucket {
  key: string; // "CORE" | "SS27" | "FW26" | ...
  label: string;
  count: number;
  kind: "core" | "season" | "continuity" | "unassigned";
}

export interface CollectionMember {
  id: string;
  colorwaySku: string;
  name: string;
  styleName: string;
  tags: string[];
  thumbnailRef: string | null;
  vendor: string | null;
  productType: string | null;
  isCore: boolean;
  onSale: boolean;
  // The season the carry-over toggle targets (the viewed season, or the current
  // season for non-season buckets), and the product's origin in it (null = not
  // yet in that season → can be carried over).
  targetSeason: string;
  origin: "NEW" | "CARRYOVER" | null;
  // True when the product has an MSRP price for `targetSeason`. A carried-over
  // product with no price for its new season passes every list unnoticed and
  // then fails at push, so the list has to show it.
  hasTargetPrice: boolean;
  // Priced in some other season — i.e. carry-forward could fill the gap.
  pricedElsewhere: boolean;
}

const BARE_SEASON = /^(SS|FW)\d{2}$/i;

// A product is "on sale" if it carries a SALE* tag (case-insensitive).
function isOnSale(tags: string[]): boolean {
  return tags.some((t) => t.trim().toUpperCase().startsWith("SALE"));
}

interface Loaded {
  id: string;
  colorwaySku: string;
  name: string;
  isCore: boolean;
  tags: string[];
  vendor: string | null;
  productType: string | null;
  style: { styleName: string };
  prices: { seasonId: string }[];
  seasonImages: { url: string }[];
  entries: {
    origin: "NEW" | "CARRYOVER";
    seasonId: string;
    season: { code: string; kind: string };
  }[];
}

async function loadAll(): Promise<Loaded[]> {
  return prisma.colorway.findMany({
    // Archived colorways are retired products and merge tombstones (the losing
    // row of a merge is renamed "…--merged-into-<id>" and archived, never
    // deleted). They are history, not catalogue, and listing them here put
    // rows in front of people that they cannot act on. The drop board already
    // excludes them; this makes Collections agree.
    where: { archived: false },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      isCore: true,
      tags: true,
      vendor: true,
      productType: true,
      style: { select: { styleName: true } },
      prices: { where: { priceType: "MSRP" }, select: { seasonId: true } },
      seasonImages: { where: { slot: "MAIN" }, take: 1, select: { url: true } },
      entries: {
        select: {
          origin: true,
          seasonId: true,
          season: { select: { code: true, kind: true } },
        },
      },
    },
  }) as unknown as Promise<Loaded[]>;
}

// The season codes a colorway belongs to (real entries + bare season tags).
function seasonKeysOf(cw: Loaded): Set<string> {
  const keys = new Set<string>();
  for (const e of cw.entries) if (e.season.kind === "REGULAR") keys.add(e.season.code.toUpperCase());
  for (const t of cw.tags) if (BARE_SEASON.test(t.trim())) keys.add(t.trim().toUpperCase());
  return keys;
}

function inContinuity(cw: Loaded): boolean {
  return cw.entries.some((e) => e.season.kind === "CONTINUITY");
}

// A live product in no season at all. Such a product belongs to no bucket, so
// without one of its own it is unreachable from the page whose whole job is
// answering "where does this product live?". Today the count is zero — every
// season-less row is an archived merge tombstone, now excluded above — so the
// bucket stays hidden until one appears. It is a safety net, not a category.
function isUnassigned(cw: Loaded): boolean {
  return cw.entries.length === 0 && seasonKeysOf(cw).size === 0;
}

// Highest real season value -> used to drop future-dated typo tags (FW51 etc.).
function maxRealSeasonValue(rows: Loaded[]): number {
  let max = 0;
  for (const cw of rows)
    for (const e of cw.entries)
      if (e.season.kind === "REGULAR") max = Math.max(max, seasonSortValue(e.season.code) ?? 0);
  return max || 99999;
}

export async function getCollections(
  selected?: string,
  vendor?: string,
  sale?: "1" | "0",
  carryInto?: string
): Promise<{
  buckets: CollectionBucket[];
  members: CollectionMember[];
  selected: string;
  vendors: { vendor: string; count: number }[];
  vendor: string | null;
  sale: "1" | "0" | null;
  saleCounts: { onSale: number; notOnSale: number };
  currentSeason: string;
  // Real REGULAR seasons a product can be carried into, newest first, and the
  // one currently targeted by the carry-over controls.
  carrySeasons: string[];
  carryInto: string;
  filteredCount: number;
}> {
  const rows = await loadAll();
  // Only seasons that actually exist as rows can be carry-over targets — the
  // bucket list also contains tag-only historical seasons (SS26, FW25 …) which
  // have no Season row and would 404 on classify.
  const carrySeasons = (
    await prisma.season.findMany({ where: { kind: "REGULAR" }, select: { code: true } })
  )
    .map((s) => s.code.toUpperCase())
    .sort((a, b) => (seasonSortValue(b) ?? 0) - (seasonSortValue(a) ?? 0));
  const ceiling = maxRealSeasonValue(rows) + 5; // allow up to one season ahead

  // The "current" season = the newest REGULAR season (carry-over target).
  let currentSeason = "";
  let currentVal = -1;
  for (const cw of rows)
    for (const e of cw.entries)
      if (e.season.kind === "REGULAR") {
        const v = seasonSortValue(e.season.code) ?? -1;
        if (v > currentVal) { currentVal = v; currentSeason = e.season.code.toUpperCase(); }
      }

  // code -> id, so a product's price for the target season can be resolved even
  // when it has no entry in that season yet (i.e. before being carried in).
  const seasonIdByCode = new Map<string, string>();
  for (const cw of rows)
    for (const e of cw.entries)
      seasonIdByCode.set(e.season.code.toUpperCase(), e.seasonId);

  const seasonCounts = new Map<string, number>();
  let coreCount = 0;
  let continuityCount = 0;
  let unassignedCount = 0;
  for (const cw of rows) {
    if (cw.isCore) coreCount++;
    if (inContinuity(cw)) continuityCount++;
    if (isUnassigned(cw)) unassignedCount++;
    for (const k of seasonKeysOf(cw)) {
      const v = seasonSortValue(k);
      if (v == null || v > ceiling) continue; // skip junk/future-typo tags
      seasonCounts.set(k, (seasonCounts.get(k) ?? 0) + 1);
    }
  }

  const seasonBuckets: CollectionBucket[] = [...seasonCounts.entries()]
    .map(([key, count]) => ({ key, label: key, count, kind: "season" as const }))
    .sort((a, b) => (seasonSortValue(b.key)! - seasonSortValue(a.key)!)); // newest first

  const buckets: CollectionBucket[] = [
    { key: "CORE", label: "Core", count: coreCount, kind: "core" },
    ...seasonBuckets,
    { key: "CONTINUITY", label: "Continuity (legacy)", count: continuityCount, kind: "continuity" },
    ...(unassignedCount
      ? [
          {
            key: "UNASSIGNED",
            label: "No season",
            count: unassignedCount,
            kind: "unassigned" as const,
          },
        ]
      : []),
  ];

  const sel = selected && buckets.some((b) => b.key === selected) ? selected : buckets[0].key;

  // Full membership of the selected bucket (before any vendor filter), so the
  // vendor options + counts reflect the whole bucket, not just a display page.
  const selIsSeason = buckets.find((b) => b.key === sel)?.kind === "season";
  // Carry-over target: an explicit pick wins; otherwise the viewed bucket when
  // it is a real season, else the current season. Never a tag-only season.
  const requested = carryInto?.toUpperCase();
  const carryTarget =
    (requested && carrySeasons.includes(requested) && requested) ||
    (selIsSeason && carrySeasons.includes(sel) && sel) ||
    currentSeason;
  const NO_VENDOR = "(no vendor)";
  const all: CollectionMember[] = [];
  const vendorCounts = new Map<string, number>();
  let onSaleCount = 0;
  for (const cw of rows) {
    let match = false;
    if (sel === "CORE") match = cw.isCore;
    else if (sel === "CONTINUITY") match = inContinuity(cw);
    else if (sel === "UNASSIGNED") match = isUnassigned(cw);
    else match = seasonKeysOf(cw).has(sel);
    if (!match) continue;

    // Carry-over toggle targets the picked season; origin is the product's
    // origin in that target season.
    const targetSeason = carryTarget;
    const targetEntry = cw.entries.find((e) => e.season.code.toUpperCase() === targetSeason);
    const origin = targetEntry ? targetEntry.origin : null;
    const onSale = isOnSale(cw.tags);
    if (onSale) onSaleCount++;

    // Priced for the target season? Only meaningful once the product is in it,
    // but computed either way so the confirmation can warn before carrying.
    const targetSeasonId = targetEntry?.seasonId ?? seasonIdByCode.get(targetSeason) ?? null;
    const hasTargetPrice = targetSeasonId
      ? cw.prices.some((p) => p.seasonId === targetSeasonId)
      : false;

    all.push({
      id: cw.id,
      colorwaySku: cw.colorwaySku,
      name: cw.name,
      styleName: cw.style.styleName,
      tags: cw.tags,
      thumbnailRef: cw.seasonImages[0]?.url ?? null,
      vendor: cw.vendor,
      productType: cw.productType,
      isCore: cw.isCore,
      onSale,
      targetSeason,
      origin,
      hasTargetPrice,
      pricedElsewhere: !hasTargetPrice && cw.prices.length > 0,
    });
    const vkey = cw.vendor?.trim() || NO_VENDOR;
    vendorCounts.set(vkey, (vendorCounts.get(vkey) ?? 0) + 1);
  }

  const vendors = [...vendorCounts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));

  const activeVendor = vendor && vendorCounts.has(vendor) ? vendor : null;
  const activeSale = sale === "1" || sale === "0" ? sale : null;

  let filtered = all;
  if (activeVendor) filtered = filtered.filter((m) => (m.vendor?.trim() || NO_VENDOR) === activeVendor);
  if (activeSale) filtered = filtered.filter((m) => (activeSale === "1" ? m.onSale : !m.onSale));
  filtered = [...filtered].sort(
    (a, b) => a.styleName.localeCompare(b.styleName) || a.name.localeCompare(b.name)
  );

  // Every match is returned, not a page of them. A cap here silently hid
  // products from a list whose whole job is "where does this product live?" —
  // and once the list gained a search box, the cap made the search lie: a
  // product ranked past the cut simply looked absent from the master. The
  // client virtualizes, so the row count is a payload question, not a
  // rendering one.
  return {
    buckets,
    members: filtered,
    selected: sel,
    vendors,
    vendor: activeVendor,
    sale: activeSale,
    saleCounts: { onSale: onSaleCount, notOnSale: all.length - onSaleCount },
    currentSeason,
    carrySeasons,
    carryInto: carryTarget,
    filteredCount: filtered.length,
  };
}
