// Drops: a season ships in waves, and the first wave cannot wait for products
// that have no photography yet. A drop is a named slice of one season, so the
// merchandising team can scope "what goes live first" and push that alone.
//
// Free text rather than an enum — merchandising names its own waves, and a new
// one should not need a migration.
import { prisma } from "@/lib/db";
import { shopifyMissing } from "./readiness";

export interface DropRow {
  colorwayId: string;
  entryId: string;
  colorwaySku: string;
  name: string;
  styleName: string;
  vendor: string | null;
  productType: string | null;
  drop: string | null;
  isCore: boolean;
  origin: "NEW" | "CARRYOVER";
  /** Everything the storefront needs, resolved Shopify-first. */
  values: {
    description: string | null;
    descriptionFromChannel: boolean;
    details: string | null;
    styleTagline: string | null;
    swatchHex: string | null;
    tags: string[];
    carePageId: string | null;
    fitguidePageId: string | null;
    modelInfoId: string | null;
  };
  variantCount: number;
  imageCount: number;
  hasPrice: boolean;
  missing: string[];
  publishedToShopify: boolean;
}

export interface DropSummary {
  drop: string | null;
  label: string;
  total: number;
  ready: number;
}

export async function getDropBoard(opts: {
  seasonCode: string;
  drop?: string | null;
  vendors?: string[];
}): Promise<{
  season: string;
  drops: DropSummary[];
  rows: DropRow[];
  selectedDrop: string | null | undefined;
  fieldGaps: { field: string; missing: number }[];
}> {
  const season = await prisma.season.findUnique({
    where: { code: opts.seasonCode },
    select: { id: true, code: true },
  });
  if (!season) throw new Error(`Unknown season ${opts.seasonCode}`);

  const entries = await prisma.seasonEntry.findMany({
    where: {
      seasonId: season.id,
      colorway: {
        archived: false,
        ...(opts.vendors?.length ? { vendor: { in: opts.vendors } } : {}),
      },
    },
    select: {
      id: true,
      drop: true,
      origin: true,
      colorway: {
        select: {
          id: true, colorwaySku: true, name: true, isCore: true, vendor: true,
          productType: true, tags: true, swatchHex: true,
          shortDescription: true, fullDescription: true, details: true,
          styleTagline: true, carePageId: true, fitguidePageId: true, modelInfoId: true,
          style: { select: { styleName: true } },
          channelContent: { select: { channel: true, field: true, value: true } },
          publications: { where: { channel: "SHOPIFY" }, select: { published: true } },
          seasonImages: { where: { seasonId: season.id }, select: { id: true } },
          prices: { where: { seasonId: season.id }, select: { priceType: true } },
          _count: { select: { variants: true, media: true } },
        },
      },
    },
    orderBy: [{ colorway: { style: { styleName: "asc" } } }, { colorway: { name: "asc" } }],
  });

  const rows: DropRow[] = entries.map((e) => {
    const c = e.colorway;
    const override = c.channelContent.find(
      (x) => x.channel === "SHOPIFY" && x.field === "fullDescription"
    )?.value;
    const description = override ?? c.fullDescription ?? c.shortDescription;
    const imageCount = c._count.media + c.seasonImages.length;
    const hasPrice = c.prices.some((p) => p.priceType === "MSRP");
    return {
      colorwayId: c.id,
      entryId: e.id,
      colorwaySku: c.colorwaySku,
      name: c.name,
      styleName: c.style.styleName,
      vendor: c.vendor,
      productType: c.productType,
      drop: e.drop,
      isCore: c.isCore,
      origin: e.origin,
      values: {
        description,
        descriptionFromChannel: !!override,
        details: c.details,
        styleTagline: c.styleTagline,
        swatchHex: c.swatchHex,
        tags: c.tags,
        carePageId: c.carePageId,
        fitguidePageId: c.fitguidePageId,
        modelInfoId: c.modelInfoId,
      },
      variantCount: c._count.variants,
      imageCount,
      hasPrice,
      missing: shopifyMissing({
        hasVariants: c._count.variants > 0,
        hasPrice,
        description,
        hasImage: imageCount > 0,
        hasTags: c.tags.length > 0,
        swatchHex: c.swatchHex,
        carePageId: c.carePageId,
        fitguidePageId: c.fitguidePageId,
      }),
      publishedToShopify: c.publications.some((p) => p.published),
    };
  });

  // Drop tabs, with "unassigned" first because that is the work queue.
  const byDrop = new Map<string | null, DropRow[]>();
  for (const r of rows) byDrop.set(r.drop, [...(byDrop.get(r.drop) ?? []), r]);
  const drops: DropSummary[] = [...byDrop.entries()]
    .map(([drop, list]) => ({
      drop,
      label: drop ?? "Unassigned",
      total: list.length,
      ready: list.filter((r) => !r.missing.length).length,
    }))
    .sort((a, b) => {
      if (a.drop === null) return -1;
      if (b.drop === null) return 1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });

  const selected =
    opts.drop === undefined ? undefined : opts.drop === "" ? null : opts.drop;
  const visible =
    selected === undefined ? rows : rows.filter((r) => r.drop === selected);

  // What is blocking this view, most common first — the order to fix them in.
  const gapCount = new Map<string, number>();
  for (const r of visible) for (const m of r.missing) gapCount.set(m, (gapCount.get(m) ?? 0) + 1);
  const fieldGaps = [...gapCount.entries()]
    .map(([field, missing]) => ({ field, missing }))
    .sort((a, b) => b.missing - a.missing);

  return { season: season.code, drops, rows: visible, selectedDrop: selected, fieldGaps };
}

/** Assign (or clear) the drop on many season entries at once. */
export async function setDrop(
  entryIds: string[],
  drop: string | null
): Promise<{ updated: number }> {
  if (!entryIds.length) return { updated: 0 };
  const res = await prisma.seasonEntry.updateMany({
    where: { id: { in: entryIds } },
    data: { drop: normaliseDropName(drop) },
  });
  return { updated: res.count };
}

/** Empty, blank or whitespace-only means "no drop", not a drop called " ". */
function normaliseDropName(drop: string | null): string | null {
  return drop && drop.trim() ? drop.trim() : null;
}

/**
 * Reduce a Shopify handle or a SKU to one comparable form.
 *
 * The Shopify handle we push is the SKU lowercased (see master/publish.ts), but
 * a handle copied back out of Shopify has been through Shopify's own slug rules:
 * lowercased, every run of non-alphanumerics collapsed to a single dash, ends
 * trimmed. Applying the same reduction to both sides means a pasted handle, a
 * pasted SKU and a pasted product URL all land on the same product.
 *
 * A trailing "-1"/"-2" that Shopify adds to break a handle collision is left
 * alone — a SKU can legitimately end in a number, and guessing wrong would
 * assign the wrong product. Such a token reports as unmatched instead.
 */
export function normaliseHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Split a pasted blob into handles. Accepts commas, semicolons, newlines or
 * plain spaces as separators, and full Shopify URLs — people copy the address
 * bar, not the handle.
 */
export function parseHandleList(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const path = t.split(/[?#]/)[0];
      return path.split("/").filter(Boolean).pop() ?? path;
    })
    .filter(Boolean);
}

export interface DropByHandleResult {
  updated: number;
  matched: { handle: string; colorwaySku: string; entryId: string }[];
  /** Nothing in the catalogue reduces to this handle. */
  unmatched: string[];
  /** Found, but the product is archived — a different problem to a typo. */
  archived: { handle: string; colorwaySku: string }[];
  /** Found and live, but it has no entry in this season, so it has no drop. */
  notInSeason: { handle: string; colorwaySku: string }[];
  /** Two live products reduce to the same handle; refuse rather than guess. */
  ambiguous: { handle: string; colorwaySkus: string[] }[];
}

/**
 * Assign a drop to products named by Shopify handle (or SKU, or product URL).
 *
 * Resolved on the server against the whole catalogue rather than the rows the
 * board happens to be showing, so a pasted list works from any tab and can name
 * products currently filtered out of view. Every token that does not end up
 * assigned comes back in a bucket saying why — a silently ignored handle is how
 * half a drop goes missing.
 */
export async function setDropByHandles(
  seasonCode: string,
  handles: string[],
  drop: string | null
): Promise<DropByHandleResult> {
  const season = await prisma.season.findUnique({
    where: { code: seasonCode },
    select: { id: true },
  });
  if (!season) throw new Error(`Unknown season ${seasonCode}`);

  const [colorways, entries] = await Promise.all([
    prisma.colorway.findMany({
      select: { id: true, colorwaySku: true, archived: true },
    }),
    prisma.seasonEntry.findMany({
      where: { seasonId: season.id },
      select: { id: true, colorwayId: true },
    }),
  ]);
  const entryByColorway = new Map(entries.map((e) => [e.colorwayId, e.id]));

  const byHandle = new Map<string, typeof colorways>();
  for (const c of colorways) {
    const key = normaliseHandle(c.colorwaySku);
    byHandle.set(key, [...(byHandle.get(key) ?? []), c]);
  }

  const result: DropByHandleResult = {
    updated: 0,
    matched: [],
    unmatched: [],
    archived: [],
    notInSeason: [],
    ambiguous: [],
  };

  const seen = new Set<string>();
  for (const raw of handles) {
    const handle = normaliseHandle(raw);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);

    const candidates = byHandle.get(handle) ?? [];
    const live = candidates.filter((c) => !c.archived);

    if (!candidates.length) {
      result.unmatched.push(raw);
      continue;
    }
    if (!live.length) {
      result.archived.push({ handle: raw, colorwaySku: candidates[0].colorwaySku });
      continue;
    }
    if (live.length > 1) {
      result.ambiguous.push({ handle: raw, colorwaySkus: live.map((c) => c.colorwaySku) });
      continue;
    }
    const entryId = entryByColorway.get(live[0].id);
    if (!entryId) {
      result.notInSeason.push({ handle: raw, colorwaySku: live[0].colorwaySku });
      continue;
    }
    result.matched.push({ handle: raw, colorwaySku: live[0].colorwaySku, entryId });
  }

  if (result.matched.length) {
    const res = await prisma.seasonEntry.updateMany({
      where: { id: { in: result.matched.map((m) => m.entryId) } },
      data: { drop: normaliseDropName(drop) },
    });
    result.updated = res.count;
  }
  return result;
}
