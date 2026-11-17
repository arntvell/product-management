import Link from "next/link";
import { getShootBoard } from "@/lib/master/shoot";
import { listSeasons } from "@/lib/master/queries";
import { flatCandidates } from "@/lib/master/flats";
import { ShootPlanner } from "@/components/catalog/shoot-planner";
import { PageHeader, Page } from "@/components/ui/page-header";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";

export const dynamic = "force-dynamic";

export default async function ShootPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const season = sp.season ?? "FW26";
  // The flats list's picker: every live Livid product. Anything else goes in by SKU.
  const [board, seasons, candidates] = await Promise.all([getShootBoard(season), listSeasons(), flatCandidates()]);

  return (
    <>
      <PageHeader eyebrow="Admin" title="Shoot planner">
        <nav className={tabListClass} aria-label="Season">
          {seasons
            .filter((s) => s.code !== "CONTINUITY")
            .map((s) => (
              <Link
                key={s.code}
                href={`/catalog/shoot?season=${s.code}`}
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
          What still needs photography this season, and whether there is stock to shoot it from.
          Images are counted in Origo and on Shopify; stock is what Loom has on hand in the
          warehouse and every store, so a product not yet on Shopify still counts. A product with no images and stock lands on the shot list
          by itself; set a status to add or remove anything else, or add a product from another season
          on the Shot list tab. Tick a product as prepared once it is pulled for the shoot.
        </p>
        {board.loomError && (
          <div className="border border-ink bg-paper px-4 py-3 text-body">{board.loomError}</div>
        )}
        {board.shopifyError && (
          <div className="border border-ink bg-paper px-4 py-3 text-body">{board.shopifyError}</div>
        )}
        <ShootPlanner key={board.season} season={board.season} rows={board.rows} candidates={candidates} />
      </Page>
    </>
  );
}
