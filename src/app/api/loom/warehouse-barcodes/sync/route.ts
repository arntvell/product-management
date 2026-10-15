import { NextResponse } from "next/server";
import {
  recordChannelSend,
  summariseSend,
  syncWarehouseBarcodes,
  type ChannelSendSummary,
} from "@/lib/loom/warehouse-barcode-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/loom/warehouse-barcodes/sync
//   { dryRun?: boolean, eventId?: string }          preview or send
//   { finish: { eventIds, summary } }               record the outcome
//
// Carries barcodes the warehouse scanned out to the channels the garment is
// already live in. Not the receiver — that files the master and stops, because
// the channel writes do not fit in Loom's 15 s budget and a Loom push needs a
// person. See src/lib/loom/warehouse-barcode-sync.ts.
//
// Loom is not pushed here, exactly as in the variant editor: the response
// carries `loomGroups`, the caller sends them to /api/catalog/push/loom with
// mode "data", and then calls back with `finish` so the events can be marked.
// A Loom job can outlast one request, which is why it is not inlined.
//
// Unlike the receiver this route is NOT public — it writes to live channels, so
// it stays behind the proxy like every other push.
export async function POST(req: Request) {
  let body: {
    dryRun?: boolean;
    eventId?: string;
    finish?: { eventIds?: string[]; summary?: ChannelSendSummary };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // The second leg: the client has pushed Loom and is reporting what happened.
    if (body.finish) {
      const { eventIds, summary } = body.finish;
      if (!Array.isArray(eventIds) || !eventIds.length || !summary) {
        return NextResponse.json({ error: "finish needs eventIds and summary" }, { status: 400 });
      }
      const { marked, pending } = await recordChannelSend(eventIds, summary);
      // `stillPending`, not `pending`: the preview branch uses `pending` for a
      // row COUNT, and one field meaning a number in one answer and a boolean in
      // the other is how a truthiness check quietly reads the wrong thing.
      return NextResponse.json({ ok: true, marked, stillPending: pending });
    }

    const dryRun = body.dryRun !== false;
    const { scope, report } = await syncWarehouseBarcodes({ dryRun, eventId: body.eventId });
    return NextResponse.json({
      ok: true,
      dryRun,
      eventIds: scope.eventIds,
      colorwayIds: scope.colorwayIds,
      pending: scope.rows.length,
      report,
      summary: summariseSend(report),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Channel sync failed" },
      { status: 500 }
    );
  }
}
