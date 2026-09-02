import { NextResponse } from "next/server";
import { setDrop } from "@/lib/master/drops";

export const dynamic = "force-dynamic";

// POST /api/catalog/drops  { entryIds: string[], drop: string | null }
// Assign season entries to a drop, or clear it with null.
export async function POST(req: Request) {
  let body: { entryIds?: string[]; drop?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.entryIds) || !body.entryIds.length) {
    return NextResponse.json({ error: "entryIds is required" }, { status: 400 });
  }
  try {
    const result = await setDrop(body.entryIds, body.drop ?? null);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to set drop" },
      { status: 500 }
    );
  }
}
