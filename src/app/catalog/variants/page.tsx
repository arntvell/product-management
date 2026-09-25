import Link from "next/link";
import { listSeasons } from "@/lib/master/queries";
import { listVariantsForEditor } from "@/lib/master/variant-barcodes";
import { VariantBarcodeEditor } from "@/components/catalog/variant-barcode-editor";

export const dynamic = "force-dynamic";

export default async function VariantEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; season?: string }>;
}) {
  const { q = "", season = "" } = await searchParams;
  const [{ rows, truncated }, seasons] = await Promise.all([
    listVariantsForEditor({ q, season: season || undefined }),
    listSeasons(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Variant editor</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            barcodes
          </span>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Catalog
        </Link>
      </div>

      <form className="mt-5 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="SKU, colourway, barcode or product name  —  e.g. EXT-PNT-BCK, 0884597246191"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <select
          name="season"
          defaultValue={season}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All seasons</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.code}>
              {s.code}
            </option>
          ))}
        </select>
        <button className="shrink-0 rounded-md border bg-foreground px-4 py-2 text-sm font-medium text-background">
          Search
        </button>
      </form>

      <p className="mt-2 text-xs text-muted-foreground">
        Corrections are written to the master first, then to every Shopify
        variant and Sitoo product already linked to the garment, then re-sent to
        Loom with the colourway. A size that is not live in a channel yet has
        nothing to correct there — it carries the new barcode when it is
        published. Barcodes set here are kept on the next Threadflow sync.
      </p>

      <VariantBarcodeEditor
        key={`${q}|${season}`}
        initialRows={rows}
        truncated={truncated}
        searched={Boolean(q || season)}
      />
    </div>
  );
}
