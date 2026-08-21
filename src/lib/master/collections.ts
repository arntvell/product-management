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
  origin: "NEW" | "CARRYOVER" | null; // for the selected season, if a real entry
}

const BARE_SEASON = /^(SS|FW)\d{2}$/i;

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
  vendor?: string
): Promise<{
  buckets: CollectionBucket[];
  members: CollectionMember[];
  selected: string;
  vendors: { vendor: string; count: number }[];
  vendor: string | null;
  filteredCount: number;
}> {
  const rows = await loadAll();
  const ceiling = maxRealSeasonValue(rows) + 5; // allow up to one season ahead

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
  const NO_VENDOR = "(no vendor)";
  const all: CollectionMember[] = [];
  const vendorCounts = new Map<string, number>();
  for (const cw of rows) {
    let match = false;
    let origin: "NEW" | "CARRYOVER" | null = null;
    if (sel === "CORE") match = cw.isCore;
    else if (sel === "CONTINUITY") match = inContinuity(cw);
    else {
      match = seasonKeysOf(cw).has(sel);
      const entry = cw.entries.find((e) => e.season.code.toUpperCase() === sel);
      origin = entry ? entry.origin : null;
    }
    if (!match) continue;
    all.push({
      id: cw.id,
      name: cw.name,
      styleName: cw.style.styleName,
      thumbnailRef: cw.seasonImages[0]?.url ?? null,
      vendor: cw.vendor,
      productType: cw.productType,
      isCore: cw.isCore,
      origin,
    });
    const vkey = cw.vendor?.trim() || NO_VENDOR;
    vendorCounts.set(vkey, (vendorCounts.get(vkey) ?? 0) + 1);
  }

  const vendors = [...vendorCounts.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));

  const activeVendor = vendor && vendorCounts.has(vendor) ? vendor : null;
  const filtered = activeVendor
    ? all.filter((m) => (m.vendor?.trim() || NO_VENDOR) === activeVendor)
    : all;
  filtered.sort((a, b) => a.styleName.localeCompare(b.styleName) || a.name.localeCompare(b.name));

  const MAX = 500;
  return {
    buckets,
    members: filtered.slice(0, MAX),
    selected: sel,
    vendors,
    vendor: activeVendor,
    filteredCount: filtered.length,
  };
}
