import { NextResponse } from "next/server";
import {
  BARCODES_READY,
  LoomPayloadError,
  parseBarcodesReady,
  processBarcodesReady,
  verifyLoomSignature,
} from "@/lib/loom/warehouse-barcodes";

export const dynamic = "force-dynamic";
// Node, not edge: the signature check is node:crypto.
export const runtime = "nodejs";

// POST /api/loom/warehouse-barcodes — Loom's `barcodes.ready`.
//
// The receiver for barcodes the warehouse typed in while receiving an inbound.
// See src/lib/loom/warehouse-barcodes.ts for why it exists and
// docs/origio-warehouse-barcodes-handover-1.md for Loom's half of the contract.
//
// Public in proxy.ts, because the HMAC over the raw body IS this route's
// authentication — Loom sends `X-Loom-Signature`, not a Bearer of anything
// Origio issued.
//
// What the status codes mean to Loom, which is the whole reason they are chosen
// this carefully:
//
//   2xx                     done, never sent again
//   401 408 429 5xx timeout retried on a ladder of 8 attempts over ~10 hours
//   any other 4xx           PERMANENT refusal of the whole delivery
//
// So a row Origio cannot file is never an error status. One supplier barcode in
// a format the master refuses must not throw away the other forty sizes of the
// delivery and need a human to press "Notify Origio again". Those rows come back
// in `unfiled`, and the delivery is a 2xx.
export async function POST(req: Request) {
  // The RAW bytes. A parse and re-serialise is a different byte string for the
  // same document, and the signature is over what Loom actually sent.
  const raw = await req.text();

  if (!verifyLoomSignature(raw, req.headers.get("x-loom-signature"))) {
    // 401 is on Loom's retry ladder, which is what we want for the one failure
    // mode that is ours: a receiver deployed before LOOM_WEBHOOK_SECRET is set.
    // A genuinely tampered body simply never succeeds.
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = parseBarcodesReady(JSON.parse(raw));
  } catch (err) {
    // The one permanent refusal. A body Origio cannot read will not become
    // readable on the eighth attempt, and Loom's ladder would spend ten hours
    // discovering that.
    const detail = err instanceof LoomPayloadError || err instanceof SyntaxError ? err.message : "unreadable body";
    return NextResponse.json({ error: `cannot read payload: ${detail}` }, { status: 422 });
  }

  // An event type Origio does not handle is acknowledged, not refused: Loom
  // considers it delivered and stops, which is right — retrying would not make
  // Origio understand it — and a 4xx would flag it for a human for no reason.
  if (payload.event !== BARCODES_READY) {
    return NextResponse.json({ ok: true, ignored: payload.event }, { status: 200 });
  }

  try {
    const result = await processBarcodesReady(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // A real failure — the database is down, a transaction lost a race. 500 puts
    // the delivery back on the ladder, which is the correct answer: the barcodes
    // are still true and Origio still wants them.
    console.error("[loom:warehouse-barcodes] processing failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "processing failed" },
      { status: 500 }
    );
  }
}
