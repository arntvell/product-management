import { prisma } from "@/lib/db";
import { MediaLibrary, type MediaLibraryRow } from "@/components/catalog/media-library";

export const dynamic = "force-dynamic";

/**
 * The catalogue's Media module: every product with its images, to find the
 * ones without and fix them in place. Each row opens the same media panel the
 * Livid and External grids use.
 */
export default async function CatalogMediaPage() {
  const cws = await prisma.colorway.findMany({
    where: { archived: false },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      style: { select: { styleName: true } },
      brand: { select: { name: true } },
      entries: { select: { season: { select: { code: true } } } },
      media: { select: { url: true, role: true }, orderBy: { position: "asc" } },
      seasonImages: { select: { url: true }, take: 1 },
      publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
    },
    orderBy: [{ brand: { name: "asc" } }, { style: { styleName: "asc" } }, { name: "asc" }],
  });
  const rows: MediaLibraryRow[] = cws.map((c) => ({
    id: c.id,
    sku: c.colorwaySku,
    name: c.name,
    styleName: c.style.styleName,
    brand: c.brand?.name ?? "",
    seasons: [...new Set(c.entries.map((e) => e.season.code))],
    images: c.media.map((m) => m.url).slice(0, 6),
    count: c.media.length,
    roles: {
      GALLERY: c.media.filter((m) => m.role === "GALLERY").length,
      FLAT: c.media.filter((m) => m.role === "FLAT").length,
      MEN: c.media.filter((m) => m.role === "MEN").length,
      WOMEN: c.media.filter((m) => m.role === "WOMEN").length,
    },
    seasonImage: c.seasonImages[0]?.url ?? null,
    onShopify: c.publications.some((p) => !!p.externalId),
  }));
  return (
    <main className="mx-auto flex h-[calc(100vh-56px)] max-w-7xl flex-col px-6 py-6">
      <h1 className="text-page">Media</h1>
      <p className="mt-1 text-body text-muted-foreground">
        Every product&apos;s images. Click a product to upload, tag Flat / Men / Women, reorder
        or remove — new images reach Shopify on the next push.
      </p>
      <MediaLibrary rows={rows} />
    </main>
  );
}
