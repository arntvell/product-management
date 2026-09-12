import { NextResponse } from "next/server";
import { inferMissingBarcodes } from "@/lib/master/barcode-inference";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/catalog/barcodes/infer?limit=500
//
// Proposes barcodes for gaps in a size run, where the neighbours were allocated
// sequentially and the missing number is forced by the gap.
//
// A report, never a write. The inference reads a pattern in the neighbours, not
// a fact about the garment — a candidate is confirmed against the box or the
// brand, then applied through /api/catalog/barcodes/apply with a real authority.
export async function GET(req: Request) {
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 500) || 500, 2000);
  try {
    const r = await inferMissingBarcodes(limit);
    return NextResponse.json({
      ok: true,
      scannedColorways: r.scannedColorways,
      variantsWithoutBarcode: r.variantsWithoutBarcode,
      forced: r.candidates.filter((c) => c.confidence === "forced").length,
      likely: r.candidates.filter((c) => c.confidence === "likely").length,
      outOfSequenceCount: r.outOfSequence.length,
      outOfSequence: r.outOfSequence.map((o) => ({
        variantSku: o.variantSku,
        held: o.held,
        expected: o.expected,
        reason: o.reason,
      })),
      candidates: r.candidates.map((c) => ({
        variantSku: c.variantSku,
        colorwaySku: c.colorwaySku,
        proposed: c.proposed,
        confidence: c.confidence,
        reason: c.reason,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Inference failed" },
      { status: 500 }
    );
  }
}
