import Link from "next/link";
import { listDrafts } from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const drafts = await listDrafts({ includeFinished: true });
  const open = drafts.filter((d) => d.status === "DRAFT" || d.status === "FINALIZING");
  const finished = drafts.filter((d) => d.status !== "DRAFT" && d.status !== "FINALIZING");

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Product drafts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafts are shared and saved as you type — closing the tab, or losing the
            server, costs nothing.
          </p>
        </div>
        <Link
          href="/catalog/products/new"
          className="rounded-md border bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          + New product
        </Link>
      </div>

      {open.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No drafts in progress.
        </p>
      ) : (
        <div className="rounded-md border">
          {open.map((d) => (
            <Link
              key={d.id}
              href={`/catalog/products/drafts/${d.id}`}
              className="flex items-center justify-between gap-4 border-b px-4 py-3 text-sm transition-colors last:border-0 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{d.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[d.seasonCode, `${d.colorways} colourways`, `${d.variants} sizes`, `at “${d.step}”`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {d.finalizeError ? (
                  <div className="mt-0.5 truncate text-xs text-destructive">
                    last attempt failed: {d.finalizeError}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                {d.status === "FINALIZING" ? (
                  <span className="rounded-full border border-amber-400 px-2 py-0.5 text-amber-700 dark:text-amber-400">
                    interrupted
                  </span>
                ) : null}
                <div>{new Date(d.updatedAt).toLocaleString()}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {finished.length ? (
        <details className="mt-6 rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {finished.length} finished or discarded
          </summary>
          <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            {finished.slice(0, 50).map((d) => {
              const row = (
                <>
                  <span className="truncate">
                    {d.title} — {d.status.toLowerCase()}
                  </span>
                  <span className="shrink-0">{new Date(d.updatedAt).toLocaleDateString()}</span>
                </>
              );
              // A completed draft's page is where its publish panel lives, and
              // publishing is retryable — so it has to stay reachable after "Created".
              return d.status === "COMPLETED" ? (
                <Link
                  key={d.id}
                  href={`/catalog/products/drafts/${d.id}/done`}
                  className="flex justify-between gap-4 hover:text-foreground hover:underline"
                >
                  {row}
                </Link>
              ) : (
                <div key={d.id} className="flex justify-between gap-4">
                  {row}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </main>
  );
}
