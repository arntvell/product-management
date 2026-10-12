import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBlobMedia, listColorwayMedia, reorderMedia } from "@/lib/master/media";

export const dynamic = "force-dynamic";

// GET /api/catalog/media?colorwayId= — one product's images, for the media
// panel the bulk editors open in place.
export async function GET(req: Request) {
  const colorwayId = new URL(req.url).searchParams.get("colorwayId");
  if (!colorwayId) return NextResponse.json({ error: "colorwayId required" }, { status: 400 });
  const cw = await prisma.colorway.findUnique({
    where: { id: colorwayId },
    select: { id: true, name: true, styleId: true, colorwaySku: true, style: { select: { styleName: true } } },
  });
  if (!cw) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  return NextResponse.json({ colorway: cw, media: await listColorwayMedia(colorwayId) });
}

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
