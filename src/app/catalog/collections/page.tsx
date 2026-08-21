import Link from "next/link";
import { getCollections } from "@/lib/master/collections";
import { catalogImageSrc } from "@/lib/catalog-image";
import { LineControls } from "@/components/catalog/line-controls";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; vendor?: string; sale?: "1" | "0" }>;
}) {
  const { c, vendor, sale } = await searchParams;
  const {
    buckets,
    members,
    selected,
    vendors,
    vendor: activeVendor,
    sale: activeSale,
    saleCounts,
    filteredCount,
  } = await getCollections(c, vendor, sale);
  const current = buckets.find((b) => b.key === selected);
  // Preserve vendor + sale across links.
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ c: selected });
    if (activeVendor) p.set("vendor", activeVendor);
    if (activeSale) p.set("sale", activeSale);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) p.delete(k);
      else p.set(k, v);
    }
    return `/catalog/collections?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/catalog" className="text-xs text-muted-foreground underline underline-offset-4">
            ← Catalog
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Collections</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Browse products by line. <b>Core</b> = permanent production line;
            season buckets show what belongs to each collection, with a{" "}
            <span className="rounded bg-amber-500/15 px-1 text-[11px] font-medium text-amber-700 dark:text-amber-500">
              carry-over
            </span>{" "}
            badge for products pulled forward from an earlier season.
          </p>
        </div>
      </div>

      {/* Bucket selector */}
      <div className="mt-6 flex flex-wrap gap-2">
        {buckets.map((b) => {
          const active = b.key === selected;
          return (
            <Link
              key={b.key}
              href={`/catalog/collections?c=${encodeURIComponent(b.key)}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "hover:bg-muted"
              }`}
            >
              {b.kind === "core" && <span aria-hidden>★</span>}
              <span className="font-medium">{b.label}</span>
              <span
                className={`tabular-nums text-xs ${
                  active ? "text-background/70" : "text-muted-foreground"
                }`}
              >
                {b.count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Sale filter */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Sale</span>
        {[
          { key: undefined as string | undefined, label: "All" },
          { key: "1", label: `On sale (${saleCounts.onSale})` },
          { key: "0", label: `Not on sale (${saleCounts.notOnSale})` },
        ].map((o) => {
          const active = (activeSale ?? undefined) === o.key;
          return (
            <Link
              key={o.label}
              href={qs({ sale: o.key })}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {o.label}
            </Link>
          );
        })}
      </div>

      {/* Vendor filter */}
      {vendors.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Vendor</span>
          <Link
            href={qs({ vendor: undefined })}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              !activeVendor ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            All
          </Link>
          {vendors.map((v) => {
            const active = v.vendor === activeVendor;
            return (
              <Link
                key={v.vendor}
                href={qs({ vendor: v.vendor })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {v.vendor}{" "}
                <span className={active ? "text-background/70" : "text-muted-foreground/70"}>{v.count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Members */}
      <div className="mt-6 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          {current?.label}
          {activeVendor && <span className="font-normal text-muted-foreground"> · {activeVendor}</span>}{" "}
          <span className="font-normal text-muted-foreground">
            · {filteredCount} product{filteredCount !== 1 ? "s" : ""}
          </span>
        </h2>
        {members.length < filteredCount && (
          <span className="text-xs text-muted-foreground">
            showing first {members.length}
          </span>
        )}
      </div>

      {members.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Nothing in this collection.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-14 p-3"></th>
                <th className="p-3">Product</th>
                <th className="p-3">Vendor</th>
                <th className="p-3">Type</th>
                <th className="w-44 p-3">Line</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const src = catalogImageSrc(m.thumbnailRef);
                return (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-2">
                      <div className="h-11 w-11 overflow-hidden rounded bg-muted">
                        {src && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <Link href={`/catalog/colorways/${m.id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{m.styleName}</div>
                    </td>
                    <td className="p-3 text-muted-foreground">{m.vendor ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{m.productType ?? "—"}</td>
                    <td className="p-3">
                      <LineControls
                        colorwayId={m.id}
                        initialIsCore={m.isCore}
                        targetSeason={m.targetSeason}
                        initialOrigin={m.origin}
                        onSale={m.onSale}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
