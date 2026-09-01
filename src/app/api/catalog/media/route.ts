import { NextResponse } from "next/server";
import { createBlobMedia, reorderMedia } from "@/lib/master/media";

export const dynamic = "force-dynamic";

// POST /api/catalog/media — record an uploaded blob as a MediaAsset.
export async function POST(req: Request) {
  let body: {
    colorwayId?: string;
    url?: string;
    blobPathname?: string;
    alt?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.colorwayId || !body.url || !body.blobPathname) {
    return NextResponse.json(
      { error: "colorwayId, url and blobPathname are required" },
      { status: 400 }
    );
  }
  const asset = await createBlobMedia({
    colorwayId: body.colorwayId,
    url: body.url,
    blobPathname: body.blobPathname,
    alt: body.alt,
  });
  return NextResponse.json(asset, { status: 201 });
}

// PATCH /api/catalog/media — reorder { colorwayId, orderedIds }
export async function PATCH(req: Request) {
  let body: { colorwayId?: string; orderedIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.colorwayId || !Array.isArray(body.orderedIds)) {
    return NextResponse.json(
      { error: "colorwayId and orderedIds are required" },
      { status: 400 }
    );
  }
  await reorderMedia(body.colorwayId, body.orderedIds);
  return NextResponse.json({ ok: true });
}
