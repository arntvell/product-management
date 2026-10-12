import { NextResponse } from "next/server";
import { resizeDraft } from "@/lib/vintage/drafts";
import { draftFailure as fail } from "@/lib/vintage/draft-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/vintage/drafts/[id]/resize { count }
// More garments are added at the end; fewer come off the end. Drafts after
// this one are renumbered, and the response says which moved.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => ({}))) as { count?: number };
  try {
    return NextResponse.json({ ok: true, ...(await resizeDraft((await ctx.params).id, Number(body.count))) });
  } catch (err) {
    return fail(err);
  }
}
