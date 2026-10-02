import Link from "next/link";
import { lookupProducts } from "@/lib/master/lookup";

export const dynamic = "force-dynamic";

import type { ChannelValue } from "@/lib/master/lookup";

function Cell({ value, origio }: { value: ChannelValue; origio: string | null }) {
  if (value.raw === null) return <td className="px-3 py-1.5 text-muted-foreground">—</td>;
  if (value.invalid) {
    return (
      <td className="px-3 py-1.5 font-mono text-destructive">
        {value.raw}
        <span className="ml-1.5 text-fine uppercase">won&rsquo;t scan</span>
      </td>
    );
  }
  const differs = value.canonical !== origio;
  return (
    <td
      className={`px-3 py-1.5 font-mono ${
        differs ? " text-ink" : "text-muted-foreground"
      }`}
    >
      {value.raw}
    </td>
  );
}

export default async function LookupPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const report = q ? await lookupProducts(q) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-page">Look up</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-fine text-muted-foreground">
            barcodes by size
          </span>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-body transition-colors hover:bg-muted"
        >
          Catalog
        </Link>
      </div>

      <form className="mt-5 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="SKU, barcode, or product name  —  e.g. LIV-CN-BCHK, 7072536068642, Connely"
          className="w-full rounded-md border bg-background px-3 py-2 text-body"
        />
        <button className="shrink-0 rounded-md border bg-foreground px-4 py-2 text-body text-background">
          Search
        </button>
      </form>

      <p className="mt-2 text-fine text-muted-foreground">
        Origio is the master column. A channel value that differs from it is
        highlighted — that is a barcode to check against the physical label
        before anything is written outward.
      </p>

      {report ? (
        report.results.length === 0 ? (
          <p className="mt-8 text-body text-muted-foreground">
            Nothing matches <code className="rounded bg-muted px-1">{report.query}</code>.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            {report.results.map((r) => (
              <section key={r.colorwaySku} className="rounded-lg border">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-3">
                  <span>{r.name}</span>
                  <code className="text-fine">{r.colorwaySku}</code>
                  {r.brand ? (
                    <span className="text-fine text-muted-foreground">{r.brand}</span>
                  ) : null}
                  {r.kind !== "MERCHANDISE" ? (
                    <span className="inline-flex h-6 items-center border border-ink px-2 text-meta uppercase text-ink">
                      {r.kind}
                    </span>
                  ) : null}
                  {r.seasons.length ? (
                    <span className="text-fine text-muted-foreground">
                      {[...new Set(r.seasons)].join(" · ")}
                    </span>
                  ) : (
                    <span className="text-fine text-muted-foreground">no season</span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-fine">
                    <thead className="border-b">
                      <tr>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Origio</th>
                        <th className="px-3 py-2">Sitoo</th>
                        <th className="px-3 py-2">Shopify</th>
                        <th className="px-3 py-2">Cin7</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.sizes.map((s) => (
                        <tr
                          key={s.variantSku}
                          className={`border-b last:border-0 ${s.mismatch ? "bg-paper" : ""}`}
                        >
                          <td className="px-3 py-1.5">{s.sizeLabel}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">
                            {s.variantSku}
                          </td>
                          <td className="px-3 py-1.5 font-mono">
                            {s.origio ?? <span className="text-destructive">none</span>}
                          </td>
                          <Cell value={s.sitoo} origio={s.origio} />
                          <Cell value={s.shopify} origio={s.origio} />
                          <Cell value={s.cin7} origio={s.origio} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            {report.truncated ? (
              <p className="text-fine text-muted-foreground">
                More matches exist — narrow the search.
              </p>
            ) : null}
            {report.channelSnapshot ? (
              <p className="text-fine text-muted-foreground">
                Origio is live. Channel columns are from{" "}
                <code className="rounded bg-muted px-1">{report.channelSnapshot}</code>.
              </p>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
