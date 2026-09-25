import { NextResponse } from "next/server";
import { buildStyleSplitReport } from "@/lib/master/style-splits";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/catalog/style-splits
//
// Styles that should be one style, and the colourways stranded under the wrong
// parent. Loom groups colourways purely by our styleId FK, so this is the list
// of everything that reaches them split.
//
// A report, never an action — same contract as /api/catalog/duplicates. Each
// proposal names the style to keep and the ones to absorb; applying goes through
// /api/catalog/style-splits/apply, which previews first.
//
// ?confidence=high|medium|low  narrows the list
// ?kind=duplicate-style|self-named|promote
// ?summary=1                   counts only, for a quick check
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const report = await buildStyleSplitReport();

    const confidence = url.searchParams.get("confidence");
    const kind = url.searchParams.get("kind");
    const proposals = report.proposals.filter(
      (p) =>
        (!confidence || p.confidence === confidence) && (!kind || p.kind === kind)
    );

    if (url.searchParams.get("summary")) {
      return NextResponse.json({
        ok: true,
        counts: report.counts,
        scanned: report.scanned,
        vintageSkipped: report.vintageSkipped,
        skipped: report.skipped.length,
      });
    }

    return NextResponse.json({ ok: true, ...report, proposals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 }
    );
  }
}
