import Link from "next/link";
import { listColorwaysForPublishing, listSeasons } from "@/lib/master/queries";
import { PublishingTable } from "@/components/catalog/publishing-table";
import { PageHeader, Page } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";

export const dynamic = "force-dynamic";

export default async function PublishingPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const [rows, seasons] = await Promise.all([
    listColorwaysForPublishing(season),
    listSeasons(),
  ]);

  const filters = [
    { code: undefined as string | undefined, label: "All seasons" },
    ...seasons.map((s) => ({ code: s.code as string | undefined, label: s.code })),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Publishing"
        meta={
          <span className="text-meta uppercase tabular-nums text-muted-foreground">
            {rows.length} products
          </span>
        }
      >
        {/* Seasons are tabs, not chips: they are one choice, not a stack of
            filters. §6 */}
        <nav className={tabListClass} aria-label="Season">
          {filters.map((f) => {
            const active = season === f.code || (!season && f.code === undefined);
            return (
              <Link
                key={f.label}
                href={
                  f.code
                    ? `/catalog/publishing?season=${f.code}`
                    : "/catalog/publishing"
                }
                aria-current={active ? "page" : undefined}
                className={tabItemClass(active)}
              >
                {f.label}
              </Link>
            );
          })}
        </nav>
      </PageHeader>
      <Page>
        <Panel flush>
          <PublishingTable rows={rows} season={season} />
        </Panel>
      </Page>
    </>
  );
}
