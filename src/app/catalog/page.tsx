import Link from "next/link";
import { getCatalogCounts, type CatalogCounts } from "@/lib/master/counts";

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

  try {
    counts = await getCatalogCounts();
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown database error";
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Product Master
        </span>
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
          {ENTITIES.map(({ key, label }) => (
            <div key={key} className="rounded-lg border p-4">
              <div className="text-2xl font-semibold tabular-nums">
                {counts![key]}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* What's next */}
      <div className="mt-10 rounded-lg border bg-muted/30 p-5">
        <h2 className="text-sm font-semibold">Phase 0 complete — foundations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Postgres + Prisma schema (Style → Colorway → Variant, seasons,
          channels, lifecycle, customs) is live and migrated. The catalogue is
          empty until Phase 1 wires up the Threadflow sync.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Next (Phase 1):</span>{" "}
          pull SS27 from Threadflow into the master and browse it here.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
        >
          ← Back to the live-Shopify editor
        </Link>
      </div>
    </div>
  );
}
