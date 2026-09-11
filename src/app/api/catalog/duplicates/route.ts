import { NextResponse } from "next/server";
import { findDuplicateCandidates } from "@/lib/master/duplicate-candidates";

export const dynamic = "force-dynamic";

// GET /api/catalog/duplicates
//
// Reports the same garment held twice under different SKUs — the case barcode
// matching cannot find, because one of the two records has no barcode.
//
// A report, never an action. Each candidate names the record to keep and the
// ones to absorb; the merge itself goes through the existing
// /api/catalog/colorways/merge, which has its own preview.
export async function GET() {
  try {
    const report = await findDuplicateCandidates();
    return NextResponse.json({
      ok: true,
      scanned: report.scanned,
      vintageSkipped: report.vintageSkipped,
      high: report.candidates.filter((c) => c.confidence === "high").length,
      medium: report.candidates.filter((c) => c.confidence === "medium").length,
      candidates: report.candidates,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
