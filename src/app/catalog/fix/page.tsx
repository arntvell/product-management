import Link from "next/link";
import { getFixList } from "@/lib/master/fix-list";
import { FixGrid } from "@/components/catalog/fix-grid";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const LIVID = ["Livid Men", "Livid Femme", "Livid Unisex"];

export default async function FixPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; core?: string; livid?: string }>;
}) {
  const sp = await searchParams;
  const season = sp.season ?? "FW26";
  const includeCore = sp.core !== "0";
  const lividOnly = sp.livid !== "0";

  const seasons = await prisma.season.findMany({
    select: { code: true, kind: true },
    orderBy: { sortOrder: "asc" },
  });

  const { rows, manufacturers, counts } = await getFixList({
    seasonCode: season,
    includeCore,
    vendors: lividOnly ? LIVID : undefined,
    includeReady: false,
  });

  const href = (o: { season?: string; core?: boolean; livid?: boolean }) => {
    const p = new URLSearchParams({ season: o.season ?? season });
    if (!(o.core ?? includeCore)) p.set("core", "0");
    if (!(o.livid ?? lividOnly)) p.set("livid", "0");
    return `/catalog/fix?${p.toString()}`;
  };
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 font-medium ${on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <Link href="/catalog" className="text-xs text-muted-foreground underline underline-offset-4">
        ← Catalog
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Fix</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Products that can&apos;t reach Loom yet, and products whose customs data
        looks wrong. Edit a cell and it saves immediately as a{" "}
        <b>manual override</b> — enrichment passes skip manually-set fields, so a
        correction here is never overwritten by a later sync.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {seasons.map((s) => (
          <Link
            key={s.code}
            href={href({ season: s.code })}
            className={chip(s.code === season)}
            title={s.kind === "CONTINUITY" ? "Loom's Archive" : undefined}
          >
            {s.code}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <Link href={href({ core: !includeCore })} className={chip(includeCore)}>
          + Core
        </Link>
        <Link href={href({ livid: !lividOnly })} className={chip(lividOnly)}>
          Livid only
        </Link>
        <span className="text-muted-foreground">
          {counts.total} in scope · {counts.blocked} blocked · {counts.withWarnings} suspect ·{" "}
          {counts.unfixable} need a sync or price, not an edit
        </span>
      </div>

      {/* Keyed on the scope: the grid copies its rows into state, so without a
          remount a season switch would keep showing the previous season. */}
      <FixGrid
        key={`${season}|${includeCore}|${lividOnly}`}
        rows={rows}
        manufacturers={manufacturers}
      />
    </div>
  );
}
