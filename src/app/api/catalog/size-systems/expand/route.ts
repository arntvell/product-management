import { NextResponse } from "next/server";
import { parseSizeRange, SizeSystemError } from "@/lib/master/size-systems";
import type { SizeSystemKind } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

// POST /api/catalog/size-systems/expand  { range, kind }
//
// Expansion lives on the server so the UI, any script and the stored entries all
// agree on what "28-36 x 30,32,34" means. Duplicating the rule in the client is
// how two readings of one range drift apart.
export async function POST(req: Request) {
  let body: { range?: string; kind?: SizeSystemKind };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const entries = parseSizeRange(body.range ?? "", body.kind ?? "ONE_D");
    return NextResponse.json({ ok: true, entries });
  } catch (err) {
    if (err instanceof SizeSystemError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Could not read that range" }, { status: 500 });
  }
}
