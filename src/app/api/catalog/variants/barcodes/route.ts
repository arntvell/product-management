import { NextResponse } from "next/server";
import {
  applyVariantBarcodeEdits,
  planVariantBarcodeEdits,
  type VariantBarcodeEdit,
} from "@/lib/master/variant-barcodes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/variants/barcodes   { edits: [{ variantSku, barcode }], dryRun?, evidence? }
//
// Corrects barcodes in the master and writes them to every Shopify variant and
// Sitoo product already linked to the garment. Loom is not pushed here: the
// response carries `loomGroups`, which the caller sends to /api/catalog/push/loom
// with mode "data" — a Loom job can outlast this request. See
// src/lib/master/variant-barcodes.ts.
export async function POST(req: Request) {
  let body: { edits?: VariantBarcodeEdit[]; dryRun?: boolean; evidence?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.edits) || !body.edits.length) {
    return NextResponse.json({ error: "edits is required" }, { status: 400 });
  }
  if (body.edits.length > 2000) {
    return NextResponse.json({ error: "At most 2000 edits per request" }, { status: 400 });
  }
  try {
    const report = body.dryRun
      ? await planVariantBarcodeEdits(body.edits)
      : await applyVariantBarcodeEdits(body.edits, { evidence: body.evidence?.trim() || null });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Barcode edit failed" },
      { status: 500 }
    );
  }
}
