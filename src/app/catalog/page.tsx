import Link from "next/link";
import { getCatalogCounts, type CatalogCounts } from "@/lib/master/counts";
import { listImportedVendors } from "@/lib/master/import-shopify";
import { SyncPanel } from "@/components/catalog/sync-panel";
import { ImportPanel } from "@/components/catalog/import-panel";

export const dynamic = "force-dynamic";

const ENTITIES: Array<{ key: keyof CatalogCounts; label: string }> = [
  { key: "seasons", label: "Seasons" },
  { key: "brands", label: "Brands" },
  { key: "manufacturers", label: "Manufacturers" },
  { key: "styles", label: "Styles" },
  { key: "colorways", label: "Colorways" },
  { key: "variants", label: "Variants" },
];

export default async function CatalogPage() {
  let counts: CatalogCounts | null = null;
  let dbError: string | null = null;
  let importedVendors: { vendor: string; count: number }[] = [];

  try {
    [counts, importedVendors] = await Promise.all([
      getCatalogCounts(),
      listImportedVendors(),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown database error";
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Product Master
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/catalog/collections"
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Collections
          </Link>
          <Link
            href="/catalog/edit"
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Bulk editor
          </Link>
          <Link
            href="/catalog/drops"
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Drops
          </Link>
          <Link
            href="/catalog/fix"
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Fix
          </Link>
          <Link
            href="/catalog/publishing"
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Publishing
          </Link>
          <Link
            href="/catalog/products/new"
            className="rounded-md border bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            + New product
          </Link>
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The single source of truth for product data — Livid products synced from
        Threadflow, plus external brands created here — published out to Shopify
        and Loom. See{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          docs/product-master-architecture.md
        </code>{" "}
        for the full plan.
      </p>

      {/* Database status */}
      <div className="mt-8">
        {dbError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              Database not reachable
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{dbError}</p>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border border-green-600/30 bg-green-600/5 px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-green-600" />
            <span className="text-xs font-medium text-green-700 dark:text-green-500">
              Connected to Postgres
            </span>
          </div>
        )}
      </div>

      {/* Entity counts */}
      {counts && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ENTITIES.map(({ key, label }) => {
            const card = (
              <>
                <div className="text-2xl font-semibold tabular-nums">
                  {counts![key]}
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
              </>
            );
            return key === "styles" ? (
              <Link
                key={key}
                href="/catalog/styles"
                className="rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                {card}
                <span className="mt-2 block text-xs font-medium underline underline-offset-4">
                  Browse →
                </span>
              </Link>
            ) : (
              <div key={key} className="rounded-lg border p-4">
                {card}
              </div>
            );
          })}
        </div>
      )}

      {/* Sync + import controls */}
      <div className="mt-8 space-y-4">
        <SyncPanel />
        <ImportPanel importedVendors={importedVendors} />
      </div>

      <Link
        href="/"
        className="mt-8 inline-block text-sm font-medium underline underline-offset-4"
      >
        ← Back to the live-Shopify editor
      </Link>
    </div>
  );
}
