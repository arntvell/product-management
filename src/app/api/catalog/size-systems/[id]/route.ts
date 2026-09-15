import { NextResponse } from "next/server";
import {
  updateSizeSystem,
  SizeSystemError,
  type UpdateSizeSystemInput,
} from "@/lib/master/size-systems";

export const dynamic = "force-dynamic";

// PUT /api/catalog/size-systems/[id]  { name?, note?, archived?, entries? }
//
// A size omitted from `entries` is archived, never deleted — see the note in
// size-systems.ts. There is no DELETE for the same reason.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: UpdateSizeSystemInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await updateSizeSystem(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SizeSystemError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
