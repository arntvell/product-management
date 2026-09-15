import Link from "next/link";
import { listSizeSystems } from "@/lib/master/size-systems";
import { SizeSystemManager } from "@/components/catalog/size-system-manager";

export const dynamic = "force-dynamic";

export default async function SizeSystemsPage() {
  const systems = await listSizeSystems({ includeArchived: true });
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Size systems</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Named, ordered size runs. The product builder mints variants from these, so the
            order here is the order a size run is written in — and the SKU token is what a
            variant SKU ends with.
          </p>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to catalog
        </Link>
      </div>
      <SizeSystemManager initial={systems} />
    </main>
  );
}
