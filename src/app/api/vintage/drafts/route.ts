import { NextResponse } from "next/server";
import { createDraft, listDrafts, type DraftRowContent } from "@/lib/vintage/drafts";
import { draftFailure as fail } from "@/lib/vintage/draft-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  /api/vintage/drafts                 every drop in progress, in number order
// POST /api/vintage/drafts { drop, count, rows? }
//      start one. Numbers follow everything already taken; `rows` fills the new
//      rows in order (bringing a browser-only draft across).
export async function GET() {
  return NextResponse.json({ ok: true, drafts: await listDrafts() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    drop?: string;
    count?: number;
    rows?: Partial<DraftRowContent>[];
  };
  try {
    const r = await createDraft(body.drop ?? "", Number(body.count), body.rows ?? []);
    return NextResponse.json({ ok: true, ...r }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
