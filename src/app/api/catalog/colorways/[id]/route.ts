import { NextResponse } from "next/server";
import { updateColorway, type UpdateColorwayInput } from "@/lib/master/edit";

export const dynamic = "force-dynamic";

// PATCH /api/catalog/colorways/[id] — save enrichment + channel overrides.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: UpdateColorwayInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await updateColorway(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    const status = message === "Colorway not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
