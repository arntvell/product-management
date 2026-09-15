import { NextResponse } from "next/server";
import { createPushBatch } from "@/lib/master/push-orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/batch — { colorwayIds, channels, seasonCode?, ... }
// Creates the queue. Nothing is sent until /run.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({ ok: true, ...(await createPushBatch(body)) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create batch" },
      { status: 500 }
    );
  }
}
