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
  base: Record<string, string>;
  overrides: { SHOPIFY: Record<string, string>; LOOM: Record<string, string> };
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
      style: { select: { styleName: true } },
      channelContent: true,
      seasonImages: { where: { slot: "MAIN" }, take: 1 },
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
    },
  });
}

export type ColorwayForEdit = NonNullable<
  Awaited<ReturnType<typeof getColorwayForEdit>>
>;
