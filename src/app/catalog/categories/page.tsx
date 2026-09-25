import Link from "next/link";
import { listCategoryTree, listUnmapped } from "@/lib/master/categories";
import { CategoryManager } from "@/components/catalog/category-manager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const [categories, unmapped] = await Promise.all([
    listCategoryTree({ includeArchived: true }),
    listUnmapped(),
  ]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One vocabulary, mapped outward. Archive what should never be offered again —
            historic products keep pointing at it.
          </p>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to catalog
        </Link>
      </div>
      <CategoryManager categories={categories} unmapped={unmapped} />
    </main>
  );
}
