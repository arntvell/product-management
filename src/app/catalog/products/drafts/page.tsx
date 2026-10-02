import Link from "next/link";
import { listDrafts } from "@/lib/master/drafts";
import { PageHeader, Page } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const drafts = await listDrafts({ includeFinished: true });
  const open = drafts.filter((d) => d.status === "DRAFT" || d.status === "FINALIZING");
  const finished = drafts.filter((d) => d.status !== "DRAFT" && d.status !== "FINALIZING");

  return (
    <>
      <PageHeader
        eyebrow="Catalogue"
        title="Drafts"
        meta={
          <span className="text-meta uppercase tabular-nums text-muted-foreground">
            {open.length} in progress
          </span>
        }
        actions={
          <Link href="/catalog/products/new" className={buttonVariants()}>
            New product
          </Link>
        }
      />
      <Page>
        <Panel
          flush
          description="Drafts are shared and saved as you type — closing the tab, or losing the server, costs nothing."
        >
          {open.length === 0 ? (
            <EmptyState
              title="No drafts"
              body="Nothing is in progress. Starting a product creates its draft before the first keystroke."
              action={
                <Link
                  href="/catalog/products/new"
                  className={buttonVariants({ variant: "outline" })}
                >
                  New product
                </Link>
              }
            />
          ) : (
            <div>
              {open.map((d) => (
                <Link
                  key={d.id}
                  href={`/catalog/products/drafts/${d.id}`}
                  className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 text-body no-underline transition-colors duration-150 ease-origo last:border-0 hover:bg-hover"
                >
                  <div className="min-w-0">
                    <div className="truncate text-ink">{d.title}</div>
                    <div className="truncate text-meta uppercase text-muted-foreground">
                      {[
                        d.seasonCode,
                        `${d.colorways} colourways`,
                        `${d.variants} sizes`,
                        `at ${d.step}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {d.finalizeError ? (
                      <div className="mt-1 truncate text-body text-ink">
                        Last attempt failed: {d.finalizeError}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {/* Interrupted means a finalize stopped half-way — the one
                        state here that needs doing something about. */}
                    {d.status === "FINALIZING" ? (
                      <StatusBadge status="error" label="Interrupted" />
                    ) : (
                      <StatusBadge status="draft" />
                    )}
                    <span className="text-meta tabular-nums text-muted-foreground">
                      {formatDateTime(d.updatedAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {finished.length ? (
          <Panel title="Finished" description={`${finished.length} finished or discarded`}>
            <div className="flex flex-col">
              {finished.slice(0, 50).map((d) => {
                const row = (
                  <>
                    <span className="truncate">
                      {d.title}
                      <span className="text-muted-foreground">
                        {" — "}
                        {d.status.toLowerCase()}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatDate(d.updatedAt)}
                    </span>
                  </>
                );
                // A completed draft's page is where its publish panel lives,
                // and publishing is retryable — so it has to stay reachable
                // after "Created".
                return d.status === "COMPLETED" ? (
                  <Link
                    key={d.id}
                    href={`/catalog/products/drafts/${d.id}/done`}
                    className="flex justify-between gap-4 border-b border-line py-2 text-body no-underline last:border-0 hover:bg-hover"
                  >
                    {row}
                  </Link>
                ) : (
                  <div
                    key={d.id}
                    className="flex justify-between gap-4 border-b border-line py-2 text-body last:border-0"
                  >
                    {row}
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : null}
      </Page>
    </>
  );
}
