import Link from "next/link";
import { getIdentityGapCounts, listIdentityGaps } from "@/lib/master/identity-report";
import { IdentityPanel } from "@/components/catalog/identity-panel";

export const dynamic = "force-dynamic";

export default async function IdentityPage() {
  const [counts, page] = await Promise.all([
    getIdentityGapCounts(),
    listIdentityGaps({}, { take: 100 }),
  ]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Channel identity</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Which products are missing which id. None of this shows up anywhere until stock
            disagrees, by which point it is an investigation rather than a gap.
          </p>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Back to catalog
        </Link>
      </div>
      <IdentityPanel counts={counts} rows={page.rows} total={page.total} />
    </main>
  );
}
