import { NextResponse } from "next/server";
import { retryPushBatch } from "@/lib/master/push-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/batch/[id]/retry — { channels?, colorwayIds?, dryRun? }
// Resets FAILED / BLOCKED / UNCONFIRMED items to PENDING and runs again.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    return NextResponse.json({ ok: true, progress: await retryPushBatch(id, body) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retry failed" },
      { status: 500 }
    );
  }
}
