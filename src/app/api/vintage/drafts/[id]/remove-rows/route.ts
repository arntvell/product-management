import { NextResponse } from "next/server";
import { removeDraftRows } from "@/lib/vintage/drafts";
import { draftFailure as fail } from "@/lib/vintage/draft-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/vintage/drafts/[id]/remove-rows { rowIds }
// Take particular garments out; the rest of this drop and the drafts after it
// close up.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = (await req.json().catch(() => ({}))) as { rowIds?: string[] };
  try {
    return NextResponse.json({ ok: true, ...(await removeDraftRows((await ctx.params).id, body.rowIds ?? [])) });
  } catch (err) {
    return fail(err);
  }
}
