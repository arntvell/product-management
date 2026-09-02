import Link from "next/link";
import { getDropBoard } from "@/lib/master/drops";
import { listSeasons } from "@/lib/master/queries";
import { DropBoard } from "@/components/catalog/drop-board";

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
    <div className="mx-auto max-w-[1500px] px-6 py-10">
      <Link href="/catalog" className="text-xs text-muted-foreground underline underline-offset-4">
        ← Catalog
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Drops</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Split a season into the waves it actually ships in, so the first drop can
        go live without waiting for products that have no photography yet. Edits
        save as you leave a field; <b>Ready</b> means the product has everything a
        storefront page needs, not just a price.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
        {seasons
          .filter((s) => s.code !== "CONTINUITY")
          .map((s) => (
            <Link
              key={s.code}
              href={`/catalog/drops?season=${s.code}`}
              className={`rounded-full border px-2.5 py-1 font-medium ${
                s.code === season
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {s.code}
            </Link>
          ))}
        <Link
          href={`/catalog/drops?season=${season}${lividOnly ? "&all=1" : ""}`}
          className={`ml-2 rounded-full border px-2.5 py-1 font-medium ${
            lividOnly ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
          }`}
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
    </div>
  );
}
