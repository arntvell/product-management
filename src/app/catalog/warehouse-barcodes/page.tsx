import Link from "next/link";
import { inboundSummary, listInboundEvents } from "@/lib/loom/warehouse-barcode-report";
import { WarehouseBarcodeLog } from "@/components/catalog/warehouse-barcode-log";

export const dynamic = "force-dynamic";

export default async function WarehouseBarcodesPage() {
  const [summary, events] = await Promise.all([inboundSummary(), listInboundEvents()]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-page">Warehouse barcodes</h1>
          <p className="mt-1 max-w-3xl text-body text-muted-foreground">
            Barcodes the warehouse typed into Loom while receiving a delivery. An external
            product&rsquo;s barcode is the supplier&rsquo;s, printed on the garment, so it is not
            known when the product is created here — the sizes go to Pio without one so the
            goods can land, and the codes come back when the inbound is received. Shopify and
            Sitoo are written automatically as each delivery is filed; Loom is not, because
            Loom is where the barcode came from.
          </p>
        </div>
        <Link
          href="/catalog"
          className="shrink-0 border px-3 py-1.5 text-body transition-colors hover:bg-muted"
        >
          Catalog
        </Link>
      </div>

      <WarehouseBarcodeLog summary={summary} events={events} />
    </main>
  );
}
