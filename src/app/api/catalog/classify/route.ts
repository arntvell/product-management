import { NextResponse } from "next/server";
import { previewClassify, runClassify } from "@/lib/master/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/classify  { dryRun?: boolean }
// Recompute Season.sortOrder, Colorway.isCore, SeasonEntry.origin.
export async function POST(req: Request) {
  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body -> defaults
  }
  try {
    if (body.dryRun) {
      const preview = await previewClassify();
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await runClassify();
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Classify failed" },
      { status: 500 }
    );
  }
}
