import { NextResponse } from "next/server";
import { deleteMedia } from "@/lib/master/media";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROLES = ["GALLERY", "FLAT", "MEN", "WOMEN", "SWATCH"] as const;

// PATCH /api/catalog/media/[id] — set role (or alt).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { role?: string; alt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.role && !ROLES.includes(body.role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  const asset = await prisma.mediaAsset.update({
    where: { id },
    data: {
      ...(body.role ? { role: body.role as (typeof ROLES)[number] } : {}),
      ...(body.alt !== undefined ? { alt: body.alt } : {}),
    },
  });
  return NextResponse.json(asset);
}

// DELETE /api/catalog/media/[id] — remove a media asset (and its Blob object if owned).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await deleteMedia(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
