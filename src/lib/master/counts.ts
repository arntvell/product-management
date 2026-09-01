// Master store query helpers. Phase 1 will grow this into the ingestion +
// browse layer; for now it exposes catalogue counts so the Catalog shell can
// prove the database wiring end-to-end.
import { prisma } from "@/lib/db";

export interface CatalogCounts {
  brands: number;
  manufacturers: number;
  seasons: number;
  styles: number;
  colorways: number;
  variants: number;
}

export async function getCatalogCounts(): Promise<CatalogCounts> {
  const [brands, manufacturers, seasons, styles, colorways, variants] =
    await Promise.all([
      prisma.brand.count(),
      prisma.manufacturer.count(),
      prisma.season.count(),
      prisma.style.count(),
      prisma.colorway.count(),
      prisma.variant.count(),
    ]);

  return { brands, manufacturers, seasons, styles, colorways, variants };
}
