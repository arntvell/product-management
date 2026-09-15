import { NextResponse } from "next/server";
import { getPushBatch } from "@/lib/master/push-orchestrator";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const batch = await getPushBatch(id);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  return NextResponse.json({ batch });
}
