import { NextResponse } from "next/server";
import {
  getDraft,
  saveDraft,
  discardDraft,
  DraftConflictError,
  DraftNotFoundError,
  DraftPayloadError,
} from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

// GET    /api/catalog/drafts/[id]
// PUT    /api/catalog/drafts/[id]  { revision, payload, step? }   — autosave
// DELETE /api/catalog/drafts/[id]                                 — discard
//
// The PUT is a compare-and-swap: a stale `revision` returns 409 rather than
// overwriting whatever the other tab saved.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ draft: await getDraft(id) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { revision?: number; payload?: unknown; step?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.revision !== "number")
    return NextResponse.json({ error: "revision is required" }, { status: 400 });
  try {
    const res = await saveDraft(id, {
      revision: body.revision,
      payload: body.payload,
      step: body.step as never,
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await discardDraft(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

function fail(err: unknown) {
  if (err instanceof DraftNotFoundError)
    return NextResponse.json({ error: err.message }, { status: 404 });
  if (err instanceof DraftConflictError)
    return NextResponse.json({ error: err.message, current: err.current }, { status: 409 });
  if (err instanceof DraftPayloadError)
    return NextResponse.json({ error: err.message }, { status: 422 });
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Request failed" },
    { status: 500 }
  );
}
