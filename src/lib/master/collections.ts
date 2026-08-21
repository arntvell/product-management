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
  kind: "core" | "season" | "continuity";
}

export interface CollectionMember {
  id: string;
  name: string;
  styleName: string;
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
}

const BARE_SEASON = /^(SS|FW)\d{2}$/i;

// A product is "on sale" if it carries a SALE* tag (case-insensitive).
function isOnSale(tags: string[]): boolean {
  return tags.some((t) => t.trim().toUpperCase().startsWith("SALE"));
}

interface Loaded {
  id: string;
  name: string;
  isCore: boolean;
  tags: string[];
  vendor: string | null;
  productType: string | null;
  style: { styleName: string };
  seasonImages: { url: string }[];
  entries: { origin: "NEW" | "CARRYOVER"; season: { code: string; kind: string } }[];
}

async function loadAll(): Promise<Loaded[]> {
  return prisma.colorway.findMany({
    select: {
      id: true,
      name: true,
      isCore: true,
      tags: true,
      vendor: true,
      productType: true,
      style: { select: { styleName: true } },
      seasonImages: { where: { slot: "MAIN" }, take: 1, select: { url: true } },
      entries: { select: { origin: true, season: { select: { code: true, kind: true } } } },
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
  sale?: "1" | "0"
): Promise<{
  buckets: CollectionBucket[];
  members: CollectionMember[];
  selected: string;
  vendors: { vendor: string; count: number }[];
  vendor: string | null;
  sale: "1" | "0" | null;
  saleCounts: { onSale: number; notOnSale: number };
  currentSeason: string;
  filteredCount: number;
}> {
  const rows = await loadAll();
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

  const seasonCounts = new Map<string, number>();
  let coreCount = 0;
  let continuityCount = 0;
  for (const cw of rows) {
    if (cw.isCore) coreCount++;
    if (inContinuity(cw)) continuityCount++;
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
  ];

  const sel = selected && buckets.some((b) => b.key === selected) ? selected : buckets[0].key;

  // Full membership of the selected bucket (before any vendor filter), so the
  // vendor options + counts reflect the whole bucket, not just a display page.
  const selIsSeason = buckets.find((b) => b.key === sel)?.kind === "season";
  const NO_VENDOR = "(no vendor)";
  const all: CollectionMember[] = [];
  const vendorCounts = new Map<string, number>();
  let onSaleCount = 0;
  for (const cw of rows) {
    let match = false;
    if (sel === "CORE") match = cw.isCore;
    else if (sel === "CONTINUITY") match = inContinuity(cw);
    else match = seasonKeysOf(cw).has(sel);
    if (!match) continue;

    // Carry-over toggle targets the viewed season (if a real one) else the
    // current season; origin is the product's origin in that target season.
    const targetSeason = selIsSeason ? sel : currentSeason;
    const targetEntry = cw.entries.find((e) => e.season.code.toUpperCase() === targetSeason);
    const origin = targetEntry ? targetEntry.origin : null;
    const onSale = isOnSale(cw.tags);
    if (onSale) onSaleCount++;

    all.push({
      id: cw.id,
      name: cw.name,
      styleName: cw.style.styleName,
      thumbnailRef: cw.seasonImages[0]?.url ?? null,
      vendor: cw.vendor,
      productType: cw.productType,
      isCore: cw.isCore,
      onSale,
      targetSeason,
      origin,
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

  const MAX = 500;
  return {
    buckets,
    members: filtered.slice(0, MAX),
    selected: sel,
    vendors,
    vendor: activeVendor,
    sale: activeSale,
    saleCounts: { onSale: onSaleCount, notOnSale: all.length - onSaleCount },
    currentSeason,
    filteredCount: filtered.length,
  };
}
