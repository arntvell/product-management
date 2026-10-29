import Link from "next/link";
import { getShootBoard } from "@/lib/master/shoot";
import { listSeasons } from "@/lib/master/queries";
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
  const [board, seasons] = await Promise.all([getShootBoard(season), listSeasons()]);

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
          Images are counted in Origo and on Shopify; stock is Shopify&apos;s total across every
          location, warehouse included. A product with no images and stock lands on the shot list
          by itself; set a status to add or remove anything else.
        </p>
        {board.shopifyError && (
          <div className="border border-ink bg-paper px-4 py-3 text-body">{board.shopifyError}</div>
        )}
        <ShootPlanner key={board.season} season={board.season} rows={board.rows} />
      </Page>
    </>
  );
}
