import Link from "next/link";
import { findDuplicateCandidates } from "@/lib/master/duplicate-candidates";
import { loadPio, pioQuantityFor } from "@/lib/master/pio";
import { DuplicateRow } from "@/components/catalog/duplicate-row";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const [report, pio] = await Promise.all([findDuplicateCandidates(), loadPio()]);

  const withPio = report.candidates.map((c) => ({
    ...c,
    keepPio: pioQuantityFor(pio, c.keep.colorwaySku),
    absorbPio: c.absorb.map((a) => pioQuantityFor(pio, a.colorwaySku)),
  }));
  const high = withPio.filter((c) => c.confidence === "high");
  const medium = withPio.filter((c) => c.confidence === "medium");

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Duplicates</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            one garment, two SKUs
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
        Found by matching style, colourway name and colour — not by SKU or
        barcode, because the defining feature of these pairs is that one record
        has no barcode at all. The usual shape is a Cin7 import carrying the
        barcodes and a Threadflow sync of the same garment under the retired{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">LIV-M-</code>/
        <code className="rounded bg-muted px-1 py-0.5 text-xs">LIV-W-</code> SKU
        carrying none.
      </p>

      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border p-4">
        {[
          { label: "colorways scanned", value: report.scanned.toLocaleString("en-GB") },
          { label: "high confidence", value: String(high.length) },
          { label: "worth a look", value: String(medium.length) },
          { label: "vintage skipped", value: String(report.vintageSkipped) },
        ].map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Vintage is excluded deliberately.</strong>{" "}
        {report.vintageSkipped} name collisions are <code>VN-</code> SKUs, where
        one-of-one means six second-hand Tommy Hilfiger shirts in XL are six
        different garments sharing one name. Merging any of them would delete
        real stock.
      </p>

      {pio ? (
        <p className="mt-2 text-xs text-muted-foreground">
          The <strong className="text-foreground">Pio</strong> column is the
          warehouse&rsquo;s own quantity for each SKU, from{" "}
          <code className="rounded bg-muted px-1 py-0.5">{pio.source}</code> (
          {pio.rows.toLocaleString("en-GB")} SKUs). Stock on one side and none on
          the other is independent confirmation of which record is real.
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          High confidence — {high.length}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Identical size runs, and every barcode on one side with none on the
          other. That is both the signal and the answer to which record to keep.
        </p>
        <div className="mt-3 space-y-2">
          {high.map((c) => (
            <DuplicateRow key={c.keep.colorwayId} candidate={c} />
          ))}
        </div>
      </section>

      {medium.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Worth a look — {medium.length}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Same style, name and colour under different SKUs, but without the
            clean barcode split. Some of these are genuinely different products
            that happen to share a name.
          </p>
          <div className="mt-3 space-y-2">
            {medium.map((c) => (
              <DuplicateRow key={c.keep.colorwayId} candidate={c} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
