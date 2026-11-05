import { NextResponse } from "next/server";
import {
  addStyleToDraft,
  DraftConflictError,
  DraftNotFoundError,
  DraftPayloadError,
} from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

// POST /api/catalog/drafts/[id]/styles  { template }  — another style in this build
//
// The new style is a draft of its own, grouped under [id]. Brand, season,
// channels and kind are copied from [id]; the template is the caller's (the
// brand's defaults), since the lead's customs describe a different garment.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { template?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const draft = await addStyleToDraft(id, body.template ?? {});
    return NextResponse.json({ ok: true, draft }, { status: 201 });
  } catch (err) {
    if (err instanceof DraftNotFoundError)
      return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof DraftConflictError)
      return NextResponse.json({ error: err.message, current: err.current }, { status: 409 });
    if (err instanceof DraftPayloadError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not add a style" },
      { status: 500 }
    );
  }
}
