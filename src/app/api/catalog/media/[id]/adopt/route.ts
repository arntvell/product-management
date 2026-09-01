import { NextResponse } from "next/server";
import { adoptMedia } from "@/lib/master/media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/catalog/media/[id]/adopt — re-host an external image into Blob.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const asset = await adoptMedia(id);
    return NextResponse.json(asset);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Adopt failed" },
      { status: 500 }
    );
  }
}
