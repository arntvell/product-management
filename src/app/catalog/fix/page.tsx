import Link from "next/link";
import { getFixList } from "@/lib/master/fix-list";
import { FixGrid } from "@/components/catalog/fix-grid";

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

  const { rows, manufacturers, counts } = await getFixList({
    seasonCode: season,
    includeCore,
    vendors: lividOnly ? LIVID : undefined,
    includeReady: false,
  });

  const toggle = (key: string, on: boolean) => {
    const p = new URLSearchParams({ season });
    if (key !== "core" ? !includeCore : !on) p.set("core", "0");
    if (key !== "livid" ? !lividOnly : !on) p.set("livid", "0");
    return `/catalog/fix?${p.toString()}`;
  };

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
        <span className="rounded-full border px-2.5 py-1 font-medium">{season}</span>
        <Link
          href={toggle("core", !includeCore)}
          className={`rounded-full border px-2.5 py-1 font-medium ${includeCore ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
        >
          + Core
        </Link>
        <Link
          href={toggle("livid", !lividOnly)}
          className={`rounded-full border px-2.5 py-1 font-medium ${lividOnly ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
        >
          Livid only
        </Link>
        <span className="text-muted-foreground">
          {counts.total} in scope · {counts.blocked} blocked · {counts.withWarnings} suspect ·{" "}
          {counts.unfixable} need a sync or price, not an edit
        </span>
      </div>

      <FixGrid rows={rows} manufacturers={manufacturers} />
    </div>
  );
}
