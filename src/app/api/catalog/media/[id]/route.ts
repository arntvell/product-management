import { NextResponse } from "next/server";
import { deleteMedia } from "@/lib/master/media";

export const dynamic = "force-dynamic";

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
