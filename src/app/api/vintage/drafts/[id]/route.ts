import { NextResponse } from "next/server";
import { deleteDraft, getDraft, saveDraftContent, type DraftRowContent } from "@/lib/vintage/drafts";
import { draftFailure as fail } from "@/lib/vintage/draft-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET    /api/vintage/drafts/[id]   the drop, every row with its numbers
// PUT    /api/vintage/drafts/[id]   { revision, rows: [{ rowId, …content }], clearNotice? }
// DELETE /api/vintage/drafts/[id]   discard it; drafts after it close up
export async function GET(_req: Request, ctx: Ctx) {
  try {
    return NextResponse.json({ ok: true, draft: await getDraft((await ctx.params).id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const body = (await req.json().catch(() => ({}))) as {
    revision?: number;
    rows?: (Partial<DraftRowContent> & { rowId: string })[];
    clearNotice?: boolean;
  };
  try {
    const r = await saveDraftContent((await ctx.params).id, Number(body.revision), body.rows ?? [], {
      clearNotice: body.clearNotice,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    return NextResponse.json({ ok: true, ...(await deleteDraft((await ctx.params).id)) });
  } catch (err) {
    return fail(err);
  }
}
