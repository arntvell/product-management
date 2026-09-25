import { NextResponse } from "next/server";
import { createDraft, listDrafts } from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

// GET  /api/catalog/drafts?includeFinished=1
// POST /api/catalog/drafts — start a new one, returns its id
export async function GET(req: Request) {
  const includeFinished =
    new URL(req.url).searchParams.get("includeFinished") === "1";
  return NextResponse.json({ drafts: await listDrafts({ includeFinished }) });
}

export async function POST() {
  return NextResponse.json({ ok: true, id: await createDraft() }, { status: 201 });
}
