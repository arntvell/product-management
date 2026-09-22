import Link from "next/link";
import { prisma } from "@/lib/db";
import { listSeasons } from "@/lib/master/queries";
import { missingBrandDefaults } from "@/lib/master/brands";
import { listSizeSystems } from "@/lib/master/size-systems";
import { listCategoryTree } from "@/lib/master/categories";
import { ImportProducts } from "@/components/catalog/import-products";

export const dynamic = "force-dynamic";

export default async function ImportProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  const { batch } = await searchParams;
  const [brandRows, seasons, sizeSystems, categoryTree] = await Promise.all([
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
        // The defaults an imported product inherits. Shown read-only on the
        // screen and checked before anything can be generated or imported —
        // the file carries none of them.
        template: true,
      },
    }),
    listSeasons(),
    listSizeSystems(),
    listCategoryTree(),
  ]);

  const brands = brandRows.map((b) => {
    const defaults = {
      hsCode: b.template?.hsCode ?? "",
      countryOfOrigin: b.template?.countryOfOrigin ?? "",
      weightKg: b.template?.weightKg?.toString() ?? "",
      fiberComposition: b.template?.fiberComposition ?? "",
      customsDescription: b.template?.customsDescription ?? "",
      gender: b.template?.gender ?? "",
      unisex: b.template?.unisex ?? false,
    };
    return {
      id: b.id,
      name: b.name,
      skuToken: b.skuToken,
      defaultSizeSystemId: b.template?.defaultSizeSystemId ?? null,
      defaults,
      missingDefaults: missingBrandDefaults({ ...defaults }),
      sitooManufacturerIds: [
        ...new Set(b.channelRefs.map((r) => r.externalId).filter((x): x is string => !!x)),
      ],
    };
  });

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
            The file is generated for one brand, season, type and size system, with the
            categories you choose as a dropdown, and carries those choices inside it — so a
            sheet filled in for one batch cannot be imported against another. Customs,
            weight and country come from the brand, not from the file.
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
        categories={categories}
        resumeBatchId={batch ?? null}
      />
    </main>
  );
}
