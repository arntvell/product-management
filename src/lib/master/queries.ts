// Read-model queries for the Catalog browse UI (Phase 1).
import { prisma } from "@/lib/db";

export interface StyleListItem {
  id: string;
  styleSku: string;
  styleName: string;
  gender: string | null;
  category: string;
  colorwayCount: number;
  thumbnailRef: string | null;
}

export async function listStyles(): Promise<StyleListItem[]> {
  const styles = await prisma.style.findMany({
    orderBy: [{ styleName: "asc" }],
    include: {
      _count: { select: { colorways: true } },
      colorways: {
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
