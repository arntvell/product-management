import { NextResponse } from "next/server";
import { getColorwayForPublish, buildShopifyPreview } from "@/lib/master/publish";

export const dynamic = "force-dynamic";

// GET /api/catalog/colorways/[id]/publish-preview
// Dry-run: computes the Shopify payload without writing anything.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cw = await getColorwayForPublish(id);
  if (!cw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ preview: buildShopifyPreview(cw) });
}
