import Link from "next/link";
import { findImportGaps } from "@/lib/master/import-gaps";

export const dynamic = "force-dynamic";

const SNAPSHOT = "snapshots/2026-09-12";

export default async function ImportGapsPage() {
  const report = await findImportGaps(SNAPSHOT, [
    { pattern: /^LIV-HYS-TP-/, note: "Hayes Taupe — retiring end of September" },
  ]);

  const bySource = {
    sitoo: report.rows.filter((r) => r.source === "sitoo").length,
    shopify: report.rows.filter((r) => r.source === "shopify").length,
  };
  const both = report.rows.filter((r) => r.inSitoo && r.inShopify).length;
  const noted = report.rows.filter((r) => r.note);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Import gaps</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            real product the Cin7 backfill cannot reach
          </span>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Catalog
        </Link>
      </div>

      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        The backfill runs through the Cin7 importer, so it can only bring in what
        Cin7 holds. That made sense while Cin7 was the master and does not now
        that it is being retired — a garment selling in the shop and the webshop
        is real whether or not Cin7 ever had a record. These are skipped in
        silence by the import, so they are listed here to be created from Sitoo
        or Shopify instead.
      </p>

      {report.error ? (
        <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {report.error}
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border p-4">
            {[
              { label: "rows", value: report.rows.length },
              { label: "create from Sitoo", value: bySource.sitoo },
              { label: "create from Shopify", value: bySource.shopify },
              { label: "in both", value: both },
              { label: "flagged", value: noted.length },
            ].map((s) => (
              <div key={s.label} className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">{s.value}</span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
            ))}
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-muted-foreground">
                from <code className="rounded bg-muted px-1">{report.snapshot}</code>
              </span>
            </div>
          </div>

          {noted.length ? (
            <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              <strong className="text-foreground">{noted.length} rows need a decision, not an import.</strong>{" "}
              {noted[0].note}. They are stocked and absent from the master, so the
              gate picks them up correctly — but importing a style with two weeks
              of life left may not be worth the work.
            </p>
          ) : null}

          <div className="mt-6 overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b bg-muted/60 backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium">Barcode</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Pio</th>
                  <th className="px-3 py-2 font-medium">Exists in</th>
                  <th className="px-3 py-2 font-medium">Create from</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={r.sku}
                    className={`border-b last:border-0 ${r.note ? "bg-amber-500/5" : ""}`}
                  >
                    <td className="px-3 py-1.5 font-mono">{r.sku}</td>
                    <td className="px-3 py-1.5">
                      {r.name}
                      {r.note ? (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">{r.note}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.brand ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                      {r.barcode ?? <span className="text-destructive">none</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.priceNok ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.pioQty ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {[r.inSitoo && "Sitoo", r.inShopify && "Shopify", r.inPio && "Pio"]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{r.source}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Sitoo is preferred as the source where both hold a product: it is the
            system where a wrong value fails physically, at a till, so its data
            has been exercised in a way Shopify&rsquo;s has not.
          </p>
        </>
      )}
    </div>
  );
}
