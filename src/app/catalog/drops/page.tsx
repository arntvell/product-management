import Link from "next/link";
import { getDropBoard } from "@/lib/master/drops";
import { listSeasons } from "@/lib/master/queries";
import { DropBoard } from "@/components/catalog/drop-board";
import { PageHeader, Page } from "@/components/ui/page-header";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LIVID = ["Livid Men", "Livid Femme", "Livid Unisex"];

export default async function DropsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; drop?: string; all?: string }>;
}) {
  const sp = await searchParams;
  const season = sp.season ?? "FW26";
  const lividOnly = sp.all !== "1";
  const [board, seasons] = await Promise.all([
    getDropBoard({
      seasonCode: season,
      drop: sp.drop,
      vendors: lividOnly ? LIVID : undefined,
    }),
    listSeasons(),
  ]);

  return (
    <>
      <PageHeader eyebrow="Catalogue" title="Drops">
        <nav className={tabListClass} aria-label="Season">
          {seasons
            .filter((s) => s.code !== "CONTINUITY")
            .map((s) => (
              <Link
                key={s.code}
                href={`/catalog/drops?season=${s.code}`}
                aria-current={s.code === season ? "page" : undefined}
                className={tabItemClass(s.code === season)}
              >
                {s.code}
              </Link>
            ))}
        </nav>
      </PageHeader>
      <Page>
      <p className="max-w-3xl text-body text-muted-foreground">
        Split a season into the waves it actually ships in, so the first drop can
        go live without waiting for products that have no photography yet. Edits
        save as you leave a field; <b>Ready</b> means the product has everything a
        storefront page needs, not just a price.
      </p>

      {/* Livid-only is a filter, so it keeps the pill §5 reserves for one. */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/catalog/drops?season=${season}${lividOnly ? "&all=1" : ""}`}
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-3 text-meta uppercase no-underline transition-colors duration-150 ease-origo",
            lividOnly
              ? "border-ink bg-ink text-offwhite"
              : "border-line bg-paper text-ink hover:border-ink"
          )}
        >
          Livid only
        </Link>
      </div>

      <DropBoard
        season={board.season}
        drops={board.drops}
        rows={board.rows}
        selectedDrop={board.selectedDrop}
        fieldGaps={board.fieldGaps}
      />
      </Page>
    </>
  );
}
