import { NextResponse } from "next/server";
import { removeFlatRequest, setFlatNote } from "@/lib/master/flats";

export const dynamic = "force-dynamic";

// PATCH  /api/catalog/flats/:id  { note }  — what to know when shooting it
// DELETE /api/catalog/flats/:id            — take it off the list (open ones only)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  await setFlatNote(id, typeof body.note === "string" ? body.note.slice(0, 500) : null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await removeFlatRequest(id);
  return NextResponse.json({ ok: true });
}
