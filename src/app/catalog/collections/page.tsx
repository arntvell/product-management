import Link from "next/link";
import { getCollections } from "@/lib/master/collections";
import { CollectionsTable } from "@/components/catalog/collections-table";
import { PageHeader } from "@/components/ui/page-header";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; vendor?: string; sale?: "1" | "0"; carry?: string }>;
}) {
  const { c, vendor, sale, carry } = await searchParams;
  const {
    buckets,
    members,
    selected,
    carrySeasons,
    carryInto,
    filteredCount,
  } = await getCollections(c, vendor, sale, carry);
  const current = buckets.find((b) => b.key === selected);

  return (
    // h-full, not a viewport calculation: main already is the viewport less
    // the top bar, and the old h-[calc(100vh-1px)] overflowed it.
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Catalogue"
        title="Collections"
        meta={
          <span className="text-meta uppercase tabular-nums text-muted-foreground">
            {filteredCount} products
          </span>
        }
      >
        {/* One line belongs to one bucket, so these are tabs. The count on
            each is the §6 nav count: how much is in there. */}
        <nav className={tabListClass} aria-label="Line">
          {buckets.map((b) => {
            const active = b.key === selected;
            return (
              <Link
                key={b.key}
                href={`/catalog/collections?c=${encodeURIComponent(b.key)}&carry=${encodeURIComponent(carryInto)}`}
                aria-current={active ? "page" : undefined}
                className={tabItemClass(active)}
              >
                {b.label}
                <span className="tabular-nums">{b.count}</span>
              </Link>
            );
          })}
        </nav>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col px-8 pb-8 pt-6">
        <p className="max-w-2xl text-body text-muted-foreground">
          Products by line. <span className="text-ink">Core</span> is the
          permanent production line; a season bucket shows what belongs to that
          collection, and anything pulled forward from an earlier season is
          marked carry-over.
        </p>
        <CollectionsTable
          members={members}
          filteredCount={filteredCount}
          bucketLabel={current?.label ?? selected}
          carrySeasons={carrySeasons}
          initialSeason={carryInto}
        />
      </div>
    </div>
  );
}
