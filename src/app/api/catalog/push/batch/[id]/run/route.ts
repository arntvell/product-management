import { NextResponse } from "next/server";
import { resumePushBatch } from "@/lib/master/push-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/batch/[id]/run — { dryRun?, only? }
//
// Bounded: takes a time budget, does what it can, persists and returns. When the
// response says `done: false`, call it again — that is how a 600s Loom job fits
// inside a 300s function without either being a long loop or losing its place.
// Always resumes first, so an invocation killed mid-flight cannot strand an item.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { dryRun?: boolean; only?: ("SHOPIFY" | "LOOM" | "SITOO")[] } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    return NextResponse.json({ ok: true, progress: await resumePushBatch(id, body) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push failed" },
      { status: 500 }
    );
  }
}
