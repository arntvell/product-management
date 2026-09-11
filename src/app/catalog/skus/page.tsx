import Link from "next/link";
import { auditSkus, type StemGroup } from "@/lib/master/sku-audit";

export const dynamic = "force-dynamic";

function Group({ g }: { g: StemGroup }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{g.styleName}</span>
        <span className="flex flex-wrap gap-1.5">
          {g.stems.map((s) => (
            <code
              key={s}
              className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium"
            >
              {s}
            </code>
          ))}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {g.skus.map((s) => (
          <code key={s}>{s}</code>
        ))}
      </div>
    </div>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((s) => (
        <code key={s} className="rounded bg-muted px-1.5 py-0.5">
          {s}
        </code>
      ))}
    </div>
  );
}

export default async function SkusPage() {
  const a = await auditSkus();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">SKU conventions</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            where the master disagrees with itself
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
        A report, not a migration. A SKU is an identifier other systems have
        already stored, printed and picked stock against, so rewriting one is a
        real change — it belongs behind a decision rather than a script. What
        this <em>does</em> settle is the convention new product should follow.
      </p>

      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border p-4">
        {[
          { label: "abbreviation drift", value: a.stemDrift.length },
          { label: "retired LIV-M-/LIV-W-", value: a.legacyScheme.length },
          { label: "mixed case", value: a.mixedCase.length },
          { label: "slashed sizes", value: a.slashedSize.length },
          { label: "channel aliases", value: a.aliases.length },
          { label: "merge tombstones", value: a.tombstones.length },
        ].map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Abbreviation drift — {a.stemDrift.length} styles
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          One style, two or more abbreviations of its own name. These are the
          ones worth settling, because the same garment family is unfindable by
          prefix.
        </p>
        <div className="mt-3 space-y-2">
          {a.stemDrift.map((g) => (
            <Group key={g.styleName} g={g} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Retired scheme — {a.legacyScheme.length} styles
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Carrying a <code className="rounded bg-muted px-1">LIV-M-</code> or{" "}
          <code className="rounded bg-muted px-1">LIV-W-</code> gender-prefixed
          SKU alongside a modern one. Most of these are the duplicate pairs on
          the{" "}
          <Link href="/catalog/duplicates" className="underline">
            Duplicates
          </Link>{" "}
          page — the retired record typically holds no barcodes and no warehouse
          stock.
        </p>
        <div className="mt-3 space-y-2">
          {a.legacyScheme.map((g) => (
            <Group key={g.styleName} g={g} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Channel aliases — {a.aliases.length}
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          One garment, two names. The master holds one record; a channel calls it
          something else. Recorded rather than merged — there is only one record
          to begin with.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Origio</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">calls it</th>
              </tr>
            </thead>
            <tbody>
              {a.aliases.map((r) => (
                <tr key={`${r.channel}-${r.variantSku}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono">{r.variantSku}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.channel}</td>
                  <td className="px-3 py-1.5 font-mono">{r.externalSku}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Mixed case — {a.mixedCase.length}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Compares unequal to the same SKU typed in capitals. This is how{" "}
            <code className="rounded bg-muted px-1">LIV-Needle-W</code> and{" "}
            <code className="rounded bg-muted px-1">LIV-NEEDLE-W</code> became
            two records of one garment.
          </p>
          <div className="mt-2">
            <List items={a.mixedCase.slice(0, 80)} empty="None." />
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Slashed sizes — {a.slashedSize.length}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1">28/34</code> where the rest
            of the catalogue writes <code className="rounded bg-muted px-1">2834</code>.
            Matching normalises both, but the two spellings coexist in the data.
          </p>
          <div className="mt-2">
            <List items={a.slashedSize.slice(0, 80)} empty="None." />
          </div>
        </div>
      </section>

      {a.tombstones.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Merge tombstones — {a.tombstones.length}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Left behind by earlier merges. Harmless, but they show up in any SKU
            listing.
          </p>
          <div className="mt-2">
            <List items={a.tombstones} empty="None." />
          </div>
        </section>
      ) : null}
    </div>
  );
}
