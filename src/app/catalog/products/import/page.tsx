import Link from "next/link";
import { prisma } from "@/lib/db";
import { listSeasons, listManufacturers } from "@/lib/master/queries";
import { listSizeSystems } from "@/lib/master/size-systems";
import { listCategoryTree } from "@/lib/master/categories";
import { ImportProducts } from "@/components/catalog/import-products";

export const dynamic = "force-dynamic";

export default async function ImportProductsPage() {
  const [brandRows, seasons, sizeSystems, manufacturers, categoryTree] = await Promise.all([
    prisma.brand.findMany({
      where: { isLivid: false, archived: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        skuToken: true,
        // Whether this brand can go to Sitoo at all is decided by a reference
        // row, not by the product — so it is shown here, before a file is filled
        // in for a brand whose push would be refused.
        channelRefs: {
          where: { system: "SITOO", role: "BRAND" },
          select: { externalId: true },
        },
        template: { select: { defaultSizeSystemId: true } },
      },
    }),
    listSeasons(),
    listSizeSystems(),
    listManufacturers(),
    listCategoryTree(),
  ]);

  const brands = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    skuToken: b.skuToken,
    defaultSizeSystemId: b.template?.defaultSizeSystemId ?? null,
    sitooManufacturerIds: [
      ...new Set(b.channelRefs.map((r) => r.externalId).filter((x): x is string => !!x)),
    ],
  }));

  const categories = categoryTree
    .filter((c) => c.active && !c.archived)
    .map((c) => ({
      id: c.id,
      name: c.name,
      path: c.path,
      depth: c.depth,
      sitooCategoryId: c.sitooCategoryId,
    }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/catalog/products/new"
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            ← New product
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Import products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The file is generated for one brand, season, type and size system, and carries
            those choices inside it — so a sheet filled in for one batch cannot be imported
            against another.
          </p>
        </div>
        <Link
          href="/catalog/products/drafts"
          className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          All drafts
        </Link>
      </div>

      <ImportProducts
        brands={brands}
        seasons={seasons}
        sizeSystems={sizeSystems.filter((s) => !s.archived)}
        manufacturers={manufacturers}
        categories={categories}
      />
    </main>
  );
}
