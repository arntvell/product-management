import Link from "next/link";
import {
  listBrandIdentity,
  listUnlinkedBrandRefs,
  suggestBrandDuplicates,
} from "@/lib/master/brands";
import { BrandIdentityManager } from "@/components/catalog/brand-identity-manager";

export const dynamic = "force-dynamic";

export default async function BrandIdentityPage() {
  const [brands, unlinked, duplicates] = await Promise.all([
    listBrandIdentity(),
    listUnlinkedBrandRefs(),
    suggestBrandDuplicates(),
  ]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Brand identity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Which brand each channel&apos;s spelling belongs to, and which of our own brands
            are the same brand twice.
          </p>
        </div>
        <Link
          href="/catalog/brands"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Brand settings
        </Link>
      </div>
      <BrandIdentityManager brands={brands} unlinked={unlinked} duplicates={duplicates} />
    </main>
  );
}
