// Read-model queries for the Catalog browse UI (Phase 1).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  shopifyMissing,
  shopifyRefusing,
  loomMissing,
  readinessProfileFor,
} from "./readiness";

export interface SeasonOption {
  id: string;
  code: string;
}

export async function listBrands(): Promise<
  { id: string; name: string; isLivid: boolean; hasTemplate: boolean }[]
> {
  const brands = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isLivid: true, template: { select: { id: true } } },
  });
  return brands.map((b) => ({
    id: b.id,
    name: b.name,
    isLivid: b.isLivid,
    hasTemplate: b.template !== null,
  }));
}

export async function listManufacturers(): Promise<
  { id: string; name: string }[]
> {
  return prisma.manufacturer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export interface ChannelCellState {
  targeted: boolean;
  published: boolean;
  ready: boolean;
  missing: string[];
}

export interface PublishingRow {
  id: string;
  name: string;
  styleName: string;
  thumbnailRef: string | null;
  dropped: boolean;
  /**
   * Which Loom job this product belongs to. Livid's own production goes to the
   * wholesale catalogue; everything else reaches Loom as a stock-registry row,
   * and asking for the wrong one means the push is skipped rather than sent.
   */
  brandIsLivid: boolean;
  shopify: ChannelCellState;
  loom: ChannelCellState;
  /**
   * Sitoo has no readiness gate of its own — the POS takes identity, price and
   * classification, and there is no description or care page to be missing. So
   * `ready` tracks whether the colorway can be pushed at all, and the column is
   * here for the membership answer rather than for a publish decision: it is the
   * only place an operator can see that a garment is store-only, which is the
   * fact Loom's stock hub needs and could not previously be told.
   */
  sitoo: ChannelCellState;
}

export async function listColorwaysForPublishing(
  seasonCode?: string
): Promise<PublishingRow[]> {
  const rows = await prisma.colorway.findMany({
    where: seasonCode
      ? { entries: { some: { season: { code: seasonCode } } } }
      : {},
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
    include: {
      style: {
        select: {
          styleName: true,
          hsCode: true,
          customsDescription: true,
          weightKg: true,
          fiberComposition: true,
        },
      },
      publications: true,
      // Readiness is judged per profile, and the profile comes from the brand —
      // vintage is not missing a fit guide, it simply never has one.
      brand: { select: { name: true, isLivid: true } },
      // Season-scoped price so readiness matches the price the push will send
      // for THIS season (a product priced only in another season isn't ready).
      prices: {
        where: {
          currency: "NOK",
          priceType: "MSRP",
          ...(seasonCode ? { season: { code: seasonCode } } : {}),
        },
        take: 1,
      },
      seasonImages: { where: { slot: "MAIN" }, take: 1 },
      entries: { select: { cancelled: true, season: { select: { code: true } } } },
      channelContent: { select: { channel: true, field: true, value: true } },
      _count: { select: { variants: true, media: true } },
    },
  });

  return rows.map((cw) => {
    const pub = (ch: "SHOPIFY" | "LOOM" | "SITOO"): ChannelCellState => {
      const p = cw.publications.find((x) => x.channel === ch);
      return { targeted: !!p, published: !!p?.published, ready: false, missing: [] };
    };

    // Readiness — uses the SAME predicates the live push enforces.
    const hasVariants = cw._count.variants > 0;
    const hasPrice = cw.prices.length > 0;

    const shopDesc =
      cw.channelContent.find(
        (c) => c.channel === "SHOPIFY" && c.field === "fullDescription"
      )?.value ??
      cw.fullDescription ??
      cw.shortDescription;
    const shopifyReadinessInput = {
      hasVariants,
      hasPrice,
      description: shopDesc,
      hasImage: cw._count.media > 0 || cw.seasonImages.length > 0,
      hasTags: cw.tags.length > 0,
      swatchHex: cw.swatchHex,
      carePageId: cw.carePageId,
      fitguidePageId: cw.fitguidePageId,
      profile: readinessProfileFor(cw.brand?.name),
    };
    const shopifyMiss = shopifyMissing(shopifyReadinessInput);
    const loomMiss = loomMissing({
      hasVariants,
      hasPrice,
      hsCode: cw.hsCodeOverride ?? cw.style.hsCode,
      customsDescription: cw.customsDescriptionOverride ?? cw.style.customsDescription,
      weightKg: cw.weightKgOverride ?? cw.style.weightKg,
      fiberComposition: cw.fiberCompositionOverride ?? cw.style.fiberComposition,
      countryOfOrigin: cw.countryOfOrigin,
      hasManufacturer: !!cw.manufacturerId,
    });

    const shopify = pub("SHOPIFY");
    // Ready means "this push would go through", and what can refuse a push
    // depends on whether it creates or updates — a live product is not blocked
    // by copy the master never held. `missing` still lists everything, so the
    // badge can show the gap without calling it a blocker.
    const shopifyAction: "create" | "update" = shopify.published || shopify.targeted
      ? "update"
      : "create";
    shopify.missing = shopifyMiss;
    shopify.ready =
      shopifyRefusing(shopifyReadinessInput, { action: shopifyAction }).length === 0;
    const loom = pub("LOOM");
    loom.missing = loomMiss;
    loom.ready = loomMiss.length === 0;
    const sitoo = pub("SITOO");
    // Variants and a price are the whole of it: a till needs something to scan
    // and something to charge.
    sitoo.missing = [
      ...(hasVariants ? [] : ["variants"]),
      ...(hasPrice ? [] : ["price"]),
    ];
    sitoo.ready = sitoo.missing.length === 0;

    return {
      id: cw.id,
      name: cw.name,
      styleName: cw.style.styleName,
      thumbnailRef: cw.seasonImages[0]?.url ?? null,
      dropped: isDropped(cw.entries, seasonCode),
      brandIsLivid: cw.brand?.isLivid === true,
      shopify,
      loom,
      sitoo,
    };
  });
}

export interface ColorwayOption {
  id: string;
  label: string; // "Style — Colorway (SKU)"
}

// Lightweight list of all colorways for the product-reference pickers
// (same_product / style_with / unisex). Small enough to search client-side.
export async function listColorwayOptions(): Promise<ColorwayOption[]> {
  const rows = await prisma.colorway.findMany({
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, colorwaySku: true, style: { select: { styleName: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    label: `${c.style.styleName} — ${c.name} (${c.colorwaySku})`,
  }));
}

export async function getBrandTemplate(brandId: string) {
  const t = await prisma.brandTemplate.findUnique({ where: { brandId } });
  if (!t) return null;
  return {
    category: t.category ?? "",
    gender: t.gender ?? "",
    unisex: t.unisex,
    channels: t.channels as string[],
    hsCode: t.hsCode ?? "",
    customsDescription: t.customsDescription ?? "",
    weightKg: t.weightKg?.toString() ?? "",
    fiberComposition: t.fiberComposition ?? "",
    countryOfOrigin: t.countryOfOrigin ?? "",
    manufacturerId: t.manufacturerId ?? "",
    defaultSizeSystemId: t.defaultSizeSystemId ?? "",
    sizes: t.sizes,
  };
}

export async function listSeasons(): Promise<SeasonOption[]> {
  const seasons = await prisma.season.findMany({
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true },
  });
  return seasons;
}

export interface StyleListItem {
  id: string;
  styleSku: string;
  styleName: string;
  gender: string | null;
  category: string;
  colorwayCount: number;
  thumbnailRef: string | null;
}

export async function listStyles(
  seasonCode?: string
): Promise<StyleListItem[]> {
  // Filter to styles that have at least one colorway present in the season.
  const where: Prisma.StyleWhereInput = seasonCode
    ? { colorways: { some: { entries: { some: { season: { code: seasonCode } } } } } }
    : {};

  // When a season is selected, count/thumbnail only its colorways.
  const colorwayFilter: Prisma.ColorwayWhereInput | undefined = seasonCode
    ? { entries: { some: { season: { code: seasonCode } } } }
    : undefined;

  const styles = await prisma.style.findMany({
    where,
    orderBy: [{ styleName: "asc" }],
    include: {
      _count: { select: { colorways: { where: colorwayFilter } } },
      colorways: {
        where: colorwayFilter,
        take: 1,
        orderBy: { name: "asc" },
        include: { seasonImages: { where: { slot: "MAIN" }, take: 1 } },
      },
    },
  });

  return styles.map((s) => ({
    id: s.id,
    styleSku: s.styleSku,
    styleName: s.styleName,
    gender: s.gender,
    category: s.category,
    colorwayCount: s._count.colorways,
    thumbnailRef: s.colorways[0]?.seasonImages[0]?.url ?? null,
  }));
}

export async function getStyleDetail(id: string) {
  return prisma.style.findUnique({
    where: { id },
    include: {
      brand: true,
      colorways: {
        orderBy: { name: "asc" },
        include: {
          manufacturer: true,
          variants: { orderBy: { sizeLabel: "asc" } },
          prices: { orderBy: [{ currency: "asc" }, { priceType: "asc" }] },
          seasonImages: { where: { slot: "MAIN" }, take: 1 },
          entries: { include: { season: true } },
        },
      },
    },
  });
}

export type StyleDetail = NonNullable<Awaited<ReturnType<typeof getStyleDetail>>>;

export interface GridRow {
  id: string;
  styleName: string;
  colorwaySku: string;
  name: string;
  thumbnailRef: string | null;
  status: string;
  tags: string[];
  vendor: string;
  productType: string;
  gender: string; // "women" | "men" | "unisex" | ""
  source: string; // THREADFLOW | MANUAL | SHOPIFY_IMPORT
  swatchHex: string;
  priceNok: string;
  mediaCount: number;
  dropped: boolean;
  /** The drop this product sits in, for the selected season. */
  drop: string;
  /** How it entered the selected season — a carry-over is already live. */
  origin: string; // "NEW" | "CARRYOVER" | ""
  /** Already has a Shopify product, so a push updates rather than creates. */
  onShopify: boolean;
  /**
   * Every channel this product is targeted at, so the grid can be filtered to
   * one system's population.
   *
   * Vendor is not enough to do that. Store vintage and online vintage are both
   * `Vendor = Vintage` and share no product: 250 carry SITOO + LOOM and no
   * Shopify row, 2,248 carry SHOPIFY + LOOM and no Sitoo row. Which channels
   * hold a product is the only thing that separates them, and it is what
   * decides where an edit has to be pushed.
   */
  channels: string[];
  /**
   * The subset of `channels` the product provably EXISTS on, as opposed to being
   * aimed at: a Shopify product GID, a Sitoo variant link, a Loom publication
   * marked published. The difference decides whether a push creates or updates,
   * and it is why the old `· live` marker was wrong — it read "has a Shopify
   * GID" and printed "live", on products Shopify held as DRAFT or ARCHIVED.
   */
  channelsLive: string[];
  /**
   * True when this colorway is the only one on its style, so the two names are
   * one name and must move together. See `name` in `applyBulkChanges`.
   */
  ownsStyle: boolean;
  /**
   * The season the NOK price above belongs to, so a price edit can be written
   * back without the page having pinned one.
   *
   * Set only where it is unambiguous. Every one of the 3,674 externals is in
   * exactly one season and holds a NOK MSRP in at most that one, so the external
   * page needs no season tabs and excludes nobody. Livid products are routinely
   * in two or three, which is why the seasonal editor still asks.
   */
  priceSeasonId: string | null;
  // Reference metafields (single = Shopify GID; multi = master colorway ids)
  refs: {
    carePageId: string;
    fitguidePageId: string;
    recommendedCollectionId: string;
    modelInfoId: string;
    sameProduct: string[];
    styleWith: string[];
    styleWithUnisexHerre: string[];
    styleWithUnisexDame: string[];
  };
  base: Record<string, string>;
  overrides: { SHOPIFY: Record<string, string>; LOOM: Record<string, string> };
}

// Dropped is per-season (SeasonEntry.cancelled, from Threadflow "dropped").
// With a season selected, use that season's flag; otherwise dropped-in-any.
function isDropped(
  entries: { cancelled: boolean; season: { code: string } }[],
  seasonCode?: string
): boolean {
  if (seasonCode)
    return entries.find((e) => e.season.code === seasonCode)?.cancelled ?? false;
  return entries.some((e) => e.cancelled);
}

/** The entry for the chosen season, or the only one if a product has just one. */
function entryFor<T extends { season: { code: string } }>(
  entries: T[],
  seasonCode?: string
): T | undefined {
  if (seasonCode) return entries.find((e) => e.season.code === seasonCode);
  return entries.length === 1 ? entries[0] : undefined;
}

const GRID_TEXT_FIELDS = [
  "shortDescription",
  "fullDescription",
  "details",
  "styleTagline",
  "styleName",
] as const;

/**
 * Which half of the catalogue a grid is showing.
 *
 * "livid"    Livid's own production — seasonal, arrives through Threadflow,
 *            moves in drops.
 * "external" everything else: vintage and the resold brands. 3,674 of the 5,350
 *            colorways, 3,648 of them on CONTINUITY, all of them on Loom for the
 *            stock registry. Seasons, drops and carry-over mean nothing here —
 *            an external lives until it sells out.
 *
 * Keyed off `Brand.isLivid`, like `isLoomEligible` and for the same reason: it
 * is a fact about what the product IS, not an intent someone can tick wrong.
 */
export type BrandScope = "livid" | "external";

export async function listColorwaysForEdit(
  seasonCode?: string,
  scope?: BrandScope
): Promise<GridRow[]> {
  const rows = await prisma.colorway.findMany({
    where: {
      ...(seasonCode ? { entries: { some: { season: { code: seasonCode } } } } : {}),
      ...(scope === "livid"
        ? { brand: { isLivid: true } }
        : scope === "external"
          ? { NOT: { brand: { isLivid: true } } }
          : {}),
    },
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
    include: {
      style: {
        select: {
          styleName: true,
          gender: true,
          unisex: true,
          _count: { select: { colorways: true } },
        },
      },
      channelContent: true,
      seasonImages: { where: { slot: "MAIN" }, take: 1 },
      entries: {
        select: {
          cancelled: true,
          drop: true,
          origin: true,
          season: { select: { id: true, code: true } },
        },
      },
      // Every channel, not just Shopify: the grid filters on the whole set.
      publications: { select: { channel: true, externalId: true, published: true } },
      variants: {
        select: { channelRefs: { where: { channel: "SITOO" }, select: { id: true } } },
      },
      prices: {
        where: {
          currency: "NOK",
          priceType: "MSRP",
          ...(seasonCode ? { season: { code: seasonCode } } : {}),
        },
        take: 1,
      },
      _count: { select: { media: true } },
    },
  });

  return rows.map((cw) => {
    const overrides = {
      SHOPIFY: {} as Record<string, string>,
      LOOM: {} as Record<string, string>,
    };
    for (const c of cw.channelContent) {
      if (c.channel === "SHOPIFY" || c.channel === "LOOM") {
        overrides[c.channel][c.field] = c.value;
      }
    }
    const base: Record<string, string> = {};
    for (const f of GRID_TEXT_FIELDS) {
      base[f] = (cw[f as keyof typeof cw] as string | null) ?? "";
    }
    return {
      id: cw.id,
      styleName: cw.style.styleName,
      colorwaySku: cw.colorwaySku,
      name: cw.name,
      thumbnailRef: cw.seasonImages[0]?.url ?? null,
      status: cw.status,
      tags: cw.tags,
      vendor: cw.vendor ?? "",
      productType: cw.productType ?? "",
      gender: cw.style.unisex ? "unisex" : cw.style.gender ?? "",
      source: cw.source,
      swatchHex: cw.swatchHex ?? "",
      priceNok: cw.prices[0]?.amount.toString() ?? "",
      mediaCount: cw._count.media,
      dropped: isDropped(cw.entries, seasonCode),
      // Drop and origin live on the season entry, so they only mean anything
      // once a season is chosen.
      drop: entryFor(cw.entries, seasonCode)?.drop ?? "",
      origin: seasonCode ? entryFor(cw.entries, seasonCode)?.origin ?? "" : "",
      onShopify: cw.publications.some(
        (p) => p.channel === "SHOPIFY" && !!p.externalId
      ),
      channels: cw.publications.map((p) => p.channel).sort(),
      channelsLive: [
        ...(cw.publications.some((p) => p.channel === "SHOPIFY" && p.externalId)
          ? ["SHOPIFY"]
          : []),
        ...(cw.publications.some((p) => p.channel === "LOOM" && p.published)
          ? ["LOOM"]
          : []),
        // Sitoo records identity per variant, not per colorway, so the variant
        // link is the proof — a publication row alone is an intention.
        ...(cw.variants.some((v) => v.channelRefs.length) ? ["SITOO"] : []),
      ],
      ownsStyle: cw.style._count.colorways === 1,
      // Only when there is one answer. With several seasons the row cannot say
      // which price is "the" price, and the page's season tab decides instead.
      priceSeasonId:
        new Set(cw.entries.map((e) => e.season.id)).size === 1
          ? cw.entries[0].season.id
          : null,
      refs: {
        carePageId: cw.carePageId ?? "",
        fitguidePageId: cw.fitguidePageId ?? "",
        recommendedCollectionId: cw.recommendedCollectionId ?? "",
        modelInfoId: cw.modelInfoId ?? "",
        sameProduct: cw.sameProduct,
        styleWith: cw.styleWith,
        styleWithUnisexHerre: cw.styleWithUnisexHerre,
        styleWithUnisexDame: cw.styleWithUnisexDame,
      },
      base,
      overrides,
    };
  });
}

export async function getColorwayForEdit(id: string) {
  return prisma.colorway.findUnique({
    where: { id },
    include: {
      style: {
        select: {
          id: true,
          styleName: true,
          styleSku: true,
          // How many colourways hang off this style. The edit page needs it to
          // decide whether the style may be renamed from here: with siblings,
          // a style rename is an edit to all of them.
          _count: { select: { colorways: true } },
        },
      },
      channelContent: true,
      publications: true,
      // Which Loom job this product belongs to. The wholesale catalogue is
      // Livid-only; everything else reaches Loom as a stock-registry row, and
      // the push is skipped outright if it asks for the wrong one.
      brand: { select: { isLivid: true } },
      entries: { include: { season: { select: { id: true, code: true } } } },
      // NOK MSRP per season — the price the Shopify and Sitoo pushes send. A
      // product in two seasons has two, so the editor shows one field each
      // rather than inventing a single "the price".
      prices: {
        where: { currency: "NOK", priceType: "MSRP" },
        select: { amount: true, seasonId: true },
      },
    },
  });
}

export type ColorwayForEdit = NonNullable<
  Awaited<ReturnType<typeof getColorwayForEdit>>
>;
