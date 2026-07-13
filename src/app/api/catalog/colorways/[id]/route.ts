import { NextResponse } from "next/server";
import { updateColorway, type UpdateColorwayInput } from "@/lib/master/edit";
import { purgeColorwayBlobs } from "@/lib/master/media";
import { prisma } from "@/lib/db";

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

// DELETE /api/catalog/colorways/[id] — remove an imported/external product.
// Threadflow-synced products are protected (they'd return on the next sync).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cw = await prisma.colorway.findUnique({
    where: { id },
    select: { source: true, styleId: true },
  });
  if (!cw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (cw.source === "THREADFLOW") {
    return NextResponse.json(
      { error: "Threadflow products can't be deleted — they return on the next sync." },
      { status: 400 }
    );
  }

  await purgeColorwayBlobs([id]); // remove owned Blob objects before cascade
  await prisma.colorway.delete({ where: { id } }); // cascades children
  const remaining = await prisma.colorway.count({ where: { styleId: cw.styleId } });
  if (remaining === 0) await prisma.style.delete({ where: { id: cw.styleId } });
  return NextResponse.json({ ok: true });
}
