// Read-model queries for the Catalog browse UI (Phase 1).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

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
  shopify: ChannelCellState;
  loom: ChannelCellState;
}

function has(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
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
      prices: { where: { currency: "NOK", priceType: "MSRP" }, take: 1 },
      seasonImages: { where: { slot: "MAIN" }, take: 1 },
      entries: { select: { cancelled: true, season: { select: { code: true } } } },
      _count: { select: { variants: true } },
    },
  });

  return rows.map((cw) => {
    const pub = (ch: "SHOPIFY" | "LOOM"): ChannelCellState => {
      const p = cw.publications.find((x) => x.channel === ch);
      return { targeted: !!p, published: !!p?.published, ready: false, missing: [] };
    };

    // Readiness — mirrors the push preview's required fields.
    const hasVariants = cw._count.variants > 0;
    const shopifyMissing: string[] = [];
    if (!hasVariants) shopifyMissing.push("variants");
    if (cw.prices.length === 0) shopifyMissing.push("price");

    const hs = cw.hsCodeOverride ?? cw.style.hsCode;
    const cdesc = cw.customsDescriptionOverride ?? cw.style.customsDescription;
    const weight = cw.weightKgOverride ?? cw.style.weightKg;
    const fiber = cw.fiberCompositionOverride ?? cw.style.fiberComposition;
    const loomMissing: string[] = [];
    if (!hasVariants) loomMissing.push("variants");
    if (!has(hs)) loomMissing.push("HS code");
    if (!has(cdesc)) loomMissing.push("customs desc");
    if (weight == null) loomMissing.push("weight");
    if (!has(fiber)) loomMissing.push("fibre");
    if (!has(cw.countryOfOrigin)) loomMissing.push("origin");
    if (!cw.manufacturerId) loomMissing.push("manufacturer");

    const shopify = pub("SHOPIFY");
    shopify.missing = shopifyMissing;
    shopify.ready = shopifyMissing.length === 0;
    const loom = pub("LOOM");
    loom.missing = loomMissing;
    loom.ready = loomMissing.length === 0;

    return {
      id: cw.id,
      name: cw.name,
      styleName: cw.style.styleName,
      thumbnailRef: cw.seasonImages[0]?.url ?? null,
      dropped: isDropped(cw.entries, seasonCode),
      shopify,
      loom,
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

const GRID_TEXT_FIELDS = [
  "shortDescription",
  "fullDescription",
  "details",
  "styleTagline",
  "styleName",
] as const;

export async function listColorwaysForEdit(
  seasonCode?: string
): Promise<GridRow[]> {
  const rows = await prisma.colorway.findMany({
    where: seasonCode
      ? { entries: { some: { season: { code: seasonCode } } } }
      : {},
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
    include: {
      style: { select: { styleName: true, gender: true, unisex: true } },
      channelContent: true,
      seasonImages: { where: { slot: "MAIN" }, take: 1 },
      entries: { select: { cancelled: true, season: { select: { code: true } } } },
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
      style: { select: { id: true, styleName: true, styleSku: true } },
      channelContent: true,
      publications: true,
    },
  });
}

export type ColorwayForEdit = NonNullable<
  Awaited<ReturnType<typeof getColorwayForEdit>>
>;
