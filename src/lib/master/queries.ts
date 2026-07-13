// Read-model queries for the Catalog browse UI (Phase 1).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface SeasonOption {
  id: string;
  code: string;
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
