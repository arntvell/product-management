import { NextResponse } from "next/server";
import { cleanupOrphans } from "@/lib/master/cleanup-orphans";

export const dynamic = "force-dynamic";

// POST /api/catalog/cleanup-orphans   { since: ISO8601, dryRun? }
//
// Removes colorways a failed import left with no variants. `since` is required
// and has no default on purpose: this deletes, and the window should be stated
// by whoever runs it rather than inferred.
export async function POST(req: Request) {
  let body: { since?: string; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const since = body.since ? new Date(body.since) : null;
  if (!since || Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "since (ISO timestamp) is required" }, { status: 400 });
  }
  try {
    const r = await cleanupOrphans(since, { dryRun: body.dryRun });
    return NextResponse.json({
      ok: !r.refused,
      dryRun: r.dryRun,
      refused: r.refused,
      wouldDeleteColorways: r.plan.colorways.length,
      wouldDeleteStyles: r.plan.styles,
      dependents: r.plan.dependents,
      deletedColorways: r.deletedColorways,
      deletedStyles: r.deletedStyles,
      sample: r.plan.colorways.slice(0, 10).map((c) => c.colorwaySku),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cleanup failed" },
      { status: 500 }
    );
  }
}
