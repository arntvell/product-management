// The two searches the wizard runs while you type.
//
// Both exist to stop a duplicate before it becomes one. Typing a style name
// shows what that brand already has, ACROSS ALL SEASONS — a carry-over is the
// same style, and scoping the search to the current season would hide exactly
// the row you need to pick. Typing a colourway name under a chosen style shows
// that style's existing colourways, so "Dark Brown" entered twice is visible as
// a name before it collides as a SKU.

import { prisma } from "@/lib/db";

export interface StyleHit {
  id: string;
  styleSku: string;
  styleName: string;
  category: string;
  colorways: number;
  /** Season codes this style appears in — why it is worth reusing. */
  seasons: string[];
  /** Customs block, so picking a style prefills what it already knows. */
  hsCode: string | null;
  customsDescription: string | null;
  weightKg: string | null;
  fiberComposition: string | null;
}

export async function searchStylesForBrand(
  brandId: string,
  query: string,
  limit = 12
): Promise<StyleHit[]> {
  const q = query.trim();
  const styles = await prisma.style.findMany({
    where: {
      brandId,
      ...(q ? { styleName: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { styleName: "asc" },
    take: limit,
    select: {
      id: true,
      styleSku: true,
      styleName: true,
      category: true,
      hsCode: true,
      customsDescription: true,
      weightKg: true,
      fiberComposition: true,
      colorways: {
        select: { entries: { select: { season: { select: { code: true } } } } },
      },
    },
  });

  return styles.map((s) => ({
    id: s.id,
    styleSku: s.styleSku,
    styleName: s.styleName,
    category: s.category,
    colorways: s.colorways.length,
    seasons: [
      ...new Set(s.colorways.flatMap((c) => c.entries.map((e) => e.season.code))),
    ].sort(),
    hsCode: s.hsCode,
    customsDescription: s.customsDescription,
    weightKg: s.weightKg?.toString() ?? null,
    fiberComposition: s.fiberComposition,
  }));
}

export interface ColorwayHit {
  id: string;
  colorwaySku: string;
  name: string;
  color: string | null;
  swatchHex: string | null;
  archived: boolean;
  sizes: string[];
}

export async function listColorwaysForStyle(
  styleId: string,
  query = ""
): Promise<ColorwayHit[]> {
  const q = query.trim();
  const rows = await prisma.colorway.findMany({
    where: {
      styleId,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
    take: 50,
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      color: true,
      swatchHex: true,
      archived: true,
      variants: { select: { sizeLabel: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    colorwaySku: r.colorwaySku,
    name: r.name,
    color: r.color,
    swatchHex: r.swatchHex,
    archived: r.archived,
    sizes: r.variants.map((v) => v.sizeLabel),
  }));
}
