import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Body {
  carePageId?: string | null;
  fitguidePageId?: string | null;
  recommendedCollectionId?: string | null;
  modelInfoId?: string | null;
  sameProduct?: string[];
  styleWith?: string[];
  styleWithUnisexHerre?: string[];
  styleWithUnisexDame?: string[];
}

// PUT /api/catalog/colorways/[id]/references — set the reference metafields.
// Single refs (care/fitguide/collection/model) hold Shopify GIDs; product
// refs hold master colorway ids (resolved to Shopify GIDs at push time).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const norm = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  await prisma.colorway.update({
    where: { id },
    data: {
      carePageId: norm(body.carePageId),
      fitguidePageId: norm(body.fitguidePageId),
      recommendedCollectionId: norm(body.recommendedCollectionId),
      modelInfoId: norm(body.modelInfoId),
      sameProduct: body.sameProduct ?? [],
      styleWith: body.styleWith ?? [],
      styleWithUnisexHerre: body.styleWithUnisexHerre ?? [],
      styleWithUnisexDame: body.styleWithUnisexDame ?? [],
    },
  });
  return NextResponse.json({ ok: true });
}
