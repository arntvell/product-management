import Link from "next/link";
import { listBrandsWithSettings } from "@/lib/master/brands";
import { BrandsTable } from "@/components/catalog/brands-table";
import { NewBrandDialog } from "@/components/catalog/new-brand-dialog";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const brands = await listBrandsWithSettings();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-page">Brands</h1>
          <p className="mt-1 text-body text-muted-foreground">
            The defaults a new product inherits, and the token each brand is written with in
            a SKU.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NewBrandDialog />
          <Link
            href="/catalog/brands/identity"
            className="border px-3 py-1.5 text-body transition-colors hover:bg-muted"
          >
            Brand identity
          </Link>
          <Link
            href="/catalog"
            className="border px-3 py-1.5 text-body transition-colors hover:bg-muted"
          >
            Back to catalog
          </Link>
        </div>
      </div>
      <BrandsTable brands={brands} />
    </main>
  );
}
