import { NextResponse } from "next/server";
import {
  previewSizeLabelNormalisation,
  runSizeLabelNormalisation,
} from "@/lib/master/normalize-size-labels";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/normalize/size-labels  { dryRun?: boolean }
// Brings 2-D variant sizes into one shape across Threadflow and Cin7.
export async function POST(req: Request) {
  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body -> defaults
  }
  try {
    if (body.dryRun) {
      const preview = await previewSizeLabelNormalisation();
      return NextResponse.json({
        dryRun: true,
        ...preview,
        // The full list can run to thousands; sample it for the response.
        changes: preview.changes.slice(0, 50),
        changeCount: preview.changes.length,
      });
    }
    const result = await runSizeLabelNormalisation();
    return NextResponse.json({
      dryRun: false,
      scanned: result.scanned,
      unchanged: result.unchanged,
      updated: result.updated,
      changes: result.changes.slice(0, 50),
      changeCount: result.changes.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Normalize failed" },
      { status: 500 }
    );
  }
}
