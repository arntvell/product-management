import Link from "next/link";
import { getCollections } from "@/lib/master/collections";
import { CollectionsTable } from "@/components/catalog/collections-table";

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
    <div className="mx-auto flex h-[calc(100vh-1px)] max-w-[1600px] flex-col px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/catalog" className="text-xs text-muted-foreground underline underline-offset-4">
            ← Catalog
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Collections</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Browse products by line. <b>Core</b> = permanent production line;
            season buckets show what belongs to each collection, with a{" "}
            <span className="rounded bg-amber-500/15 px-1 text-[11px] font-medium text-amber-700 dark:text-amber-500">
              carry-over
            </span>{" "}
            badge for products pulled forward from an earlier season.
          </p>
        </div>
      </div>

      {/* Bucket selector */}
      <div className="mt-6 flex flex-wrap gap-2">
        {buckets.map((b) => {
          const active = b.key === selected;
          return (
            <Link
              key={b.key}
              href={`/catalog/collections?c=${encodeURIComponent(b.key)}&carry=${encodeURIComponent(carryInto)}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "hover:bg-muted"
              }`}
            >
              {b.kind === "core" && <span aria-hidden>★</span>}
              <span className="font-medium">{b.label}</span>
              <span
                className={`tabular-nums text-xs ${
                  active ? "text-background/70" : "text-muted-foreground"
                }`}
              >
                {b.count}
              </span>
            </Link>
          );
        })}
      </div>

      <CollectionsTable
        members={members}
        filteredCount={filteredCount}
        bucketLabel={current?.label ?? selected}
        carrySeasons={carrySeasons}
        initialSeason={carryInto}
      />
    </div>
  );
}
