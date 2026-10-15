import { NextResponse } from "next/server";
import { syncWarehouseBarcodes } from "@/lib/loom/warehouse-barcode-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/loom/warehouse-barcodes/sync   { dryRun?: boolean, eventId?: string }
//
// Writes barcodes the warehouse scanned to the channels the garment is already
// live in. Normally nobody calls this: the receiver runs the same work itself
// once it has answered Loom. It exists for the rows a run could not finish — a
// Sitoo outage, a Shopify timeout — which stay pending until a person sends them
// from /catalog/warehouse-barcodes.
//
// `dryRun` defaults to TRUE. A caller that forgets the flag gets a preview, not a
// write to two live channels.
//
// Loom is not a target. The barcode came from there; see the note at the top of
// warehouse-barcode-sync.ts.
//
// Unlike the receiver this route is NOT public — it writes to live channels, so
// it stays behind the proxy like every other push.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; eventId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // No body is a preview of everything pending, which is the safe reading.
  }

  try {
    const dryRun = body.dryRun !== false;
    const { scope, report, summary, stillPending } = await syncWarehouseBarcodes({
      dryRun,
      eventId: body.eventId,
    });
    return NextResponse.json({
      ok: true,
      dryRun,
      eventIds: scope.eventIds,
      colorwayIds: scope.colorwayIds,
      pending: scope.rows.length,
      report,
      summary,
      stillPending,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Channel sync failed" },
      { status: 500 }
    );
  }
}
