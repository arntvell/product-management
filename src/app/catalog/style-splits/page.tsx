import Link from "next/link";
import { buildStyleSplitReport } from "@/lib/master/style-splits";
import { StyleSplitRow } from "@/components/catalog/style-split-row";
import { StyleSplitPending } from "@/components/catalog/style-split-pending";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KINDS = ["duplicate-style", "self-named", "promote"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function StyleSplitsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; confidence?: string; q?: string }>;
}) {
  const { kind, confidence, q } = await searchParams;
  const report = await buildStyleSplitReport();

  const needle = (q ?? "").trim().toLowerCase();
  const shown = report.proposals.filter(
    (p) =>
      (!kind || p.kind === kind) &&
      (!confidence || p.confidence === confidence) &&
      (!needle ||
        p.target.styleName.toLowerCase().includes(needle) ||
        p.target.styleSku.toLowerCase().includes(needle) ||
        p.absorb.some(
          (a) =>
            a.styleName.toLowerCase().includes(needle) ||
            a.styleSku.toLowerCase().includes(needle)
        ))
  );

  const filterHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { kind, confidence, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/catalog/style-splits?${s}` : "/catalog/style-splits";
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Style splits</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            one garment, several styles
          </span>
        </div>
        <Link href="/catalog" className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted">
          Catalog
        </Link>
      </div>

      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        Loom groups colourways by one thing: our{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">Colorway.styleId</code>{" "}
        foreign key. A colourway has no style of its own over there — it belongs
        to whichever style block it arrives in, and every push rewrites the
        grouping from our structure. So a split here is a split there, and
        re-pointing the parent is the whole fix. No colourway id is ever written,
        which is what keeps order history, stock and costs attached.
      </p>

      <StyleSplitPending />

      <ol className="mt-4 max-w-3xl list-decimal space-y-1 rounded-lg border p-4 pl-8 text-sm text-muted-foreground">
        <li>
          Work through a row: the ticked colourways are the ones that will move
          under the style marked <strong className="text-foreground">keep</strong>.
          Untick anything that does not belong, or use{" "}
          <em>not this one</em> to reject a whole style — that is remembered, so
          it will not come back on the next run.
        </li>
        <li>
          <strong className="text-foreground">Dry run</strong> shows what would
          change without writing anything.
        </li>
        <li>
          <strong className="text-foreground">Apply &amp; push to Loom</strong> does
          both halves: it re-nests the colourways here, then sends that style to
          Loom, one delivery per season. The row then says what Loom made of it.
        </li>
        <li>
          Start with one or two. Until Loom confirms what happens to a style that
          has been emptied, there is no way to know from this side.
        </li>
      </ol>

      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border p-4">
        {[
          { label: "styles scanned", value: report.scanned.toLocaleString("en-GB") },
          { label: "high confidence", value: String(report.counts.high) },
          { label: "worth a look", value: String(report.counts.medium) },
          { label: "needs a call", value: String(report.counts.low) },
          { label: "colourways to move", value: report.counts.colorwaysMoved.toLocaleString("en-GB") },
          { label: "styles left empty", value: report.counts.stylesEmptied.toLocaleString("en-GB") },
        ].map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">
          {report.counts.stylesEmptiedInLoom.toLocaleString("en-GB")} of the emptied
          styles are already in Loom.
        </strong>{" "}
        A style with no colourways stops appearing in the payload, and{" "}
        <code>channels.loom</code> — Loom&rsquo;s only withdraw signal — exists on
        colourways, never on styles. So those become empty shells over there until
        Loom says otherwise. Apply one cluster, push it, and check what happens
        before running the rest.
      </p>

      <p className="mt-2 rounded-lg border p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Vintage is excluded deliberately.</strong>{" "}
        {report.vintageSkipped.toLocaleString("en-GB")} styles are one-of-one{" "}
        <code>VN-</code>/<code>EXT-VN-</code> stock, where six second-hand shirts in
        XL are six garments sharing one name. A further {report.skipped.length} are
        left alone for reasons listed in the API response.
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        <Pill href={filterHref({ confidence: undefined })} active={!confidence}>
          All confidence
        </Pill>
        {CONFIDENCES.map((c) => (
          <Pill key={c} href={filterHref({ confidence: c })} active={confidence === c}>
            {c}
          </Pill>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pill href={filterHref({ kind: undefined })} active={!kind}>
          All kinds
        </Pill>
        {KINDS.map((k) => (
          <Pill key={k} href={filterHref({ kind: k })} active={kind === k}>
            {k}
          </Pill>
        ))}
      </div>

      <form className="mt-3" action="/catalog/style-splits">
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        {confidence ? <input type="hidden" name="confidence" value={confidence} /> : null}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Filter by style name or SKU — Barnes, LIV-W-KR…"
          className="w-full rounded-md border px-3 py-1.5 text-sm"
        />
      </form>

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {shown.length} of {report.proposals.length}
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          High confidence means the survivor is decided for you: one side is the
          Threadflow row, and the sync writes to it. Medium and low are proposals
          — the leading word is usually the garment, but{" "}
          <em>Keri Surf</em> is a short and not the Keri jeans. Reject a row with{" "}
          <em>not this one</em> and it stays rejected on the next run.
        </p>
        <div className="mt-4 space-y-3">
          {shown.slice(0, 200).map((p) => (
            <StyleSplitRow
              key={`${p.kind}:${p.target.styleId}`}
              proposal={p}
              defaultChecked={p.confidence === "high"}
            />
          ))}
        </div>
        {shown.length > 200 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Showing the first 200. Narrow with the filters above.
          </p>
        ) : null}
      </section>
    </div>
  );
}
