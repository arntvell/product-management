import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";
import { getStyleDetail, type StyleDetail } from "@/lib/master/queries";
import { catalogImageSrc } from "@/lib/catalog-image";

export const dynamic = "force-dynamic";

type Colorway = StyleDetail["colorways"][number];

function nokPrices(cw: Colorway): { msrp?: string; ws?: string } {
  const out: { msrp?: string; ws?: string } = {};
  for (const p of cw.prices) {
    if (p.currency !== "NOK") continue;
    if (p.priceType === "MSRP") out.msrp = p.amount.toString();
    if (p.priceType === "WHOLESALE") out.ws = p.amount.toString();
  }
  return out;
}

export default async function StyleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const style = await getStyleDetail(id);
  if (!style) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/catalog/styles"
        className="text-fine text-muted-foreground underline underline-offset-4"
      >
        ← Styles
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-page">{style.styleName}</h1>
        <span className="font-mono text-body text-muted-foreground">
          {style.styleSku}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-fine text-muted-foreground">
        {style.brand && <Badge variant="outline">{style.brand.name}</Badge>}
        {style.gender && <Badge variant="outline" className="capitalize">{style.gender}</Badge>}
        <Badge variant="outline">{style.category}</Badge>
        {style.unisex && <Badge variant="outline">Unisex</Badge>}
        {style.fiberComposition && <Badge variant="outline">{style.fiberComposition}</Badge>}
        {style.hsCode && <Badge variant="outline">HS {style.hsCode}</Badge>}
      </div>

      <h2 className="mt-8 text-body text-muted-foreground">
        {style.colorways.length} colorways
      </h2>

      <div className="mt-4 space-y-4">
        {style.colorways.map((cw) => {
          const src = catalogImageSrc(cw.seasonImages[0]?.url);
          const prices = nokPrices(cw);
          const entry = cw.entries[0];
          return (
            <div key={cw.id} className="flex gap-4 rounded-lg border p-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded bg-muted">
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {cw.swatchHex && (
                    <span
                      className="h-4 w-4 rounded-full border"
                      style={{ backgroundColor: cw.swatchHex }}
                      title={cw.swatchHex}
                    />
                  )}
                  <Link
                    href={`/catalog/colorways/${cw.id}`}
                    className="hover:underline"
                  >
                    {cw.name}
                  </Link>
                  {entry?.cancelled && (
                    <Badge variant="outline">
                      Dropped
                    </Badge>
                  )}
                  {entry?.approvedForProduction ? (
                    <Badge variant="outline">
                      Approved
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Not approved</Badge>
                  )}
                </div>

                <div className="mt-1 font-mono text-fine text-muted-foreground">
                  {cw.colorwaySku}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-fine text-muted-foreground">
                  {cw.manufacturer && <span>Mfr: {cw.manufacturer.name}</span>}
                  {cw.countryOfOrigin && <span>Origin: {cw.countryOfOrigin}</span>}
                  {prices.msrp && (
                    <span className="tabular-nums">MSRP {prices.msrp} NOK</span>
                  )}
                  {prices.ws && (
                    <span className="tabular-nums">WS {prices.ws} NOK</span>
                  )}
                  <span>{cw.variants.length} variants</span>
                </div>

                {/* Variants */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {cw.variants.map((v) => (
                    <span
                      key={v.id}
                      className="rounded border px-2 py-0.5 text-fine"
                      title={`${v.variantSku}${
                        v.barcode ? ` · ${v.barcode}` : " · no barcode"
                      }`}
                    >
                      {v.sizeLabel}
                      {v.barcode ? (
                        <span className="ml-1 text-ink">•</span>
                      ) : (
                        <span className="ml-1 text-muted-foreground/40">•</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

