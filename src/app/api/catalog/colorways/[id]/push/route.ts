import { NextResponse } from "next/server";
import { pushColorwayToShopify } from "@/lib/master/push-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/catalog/colorways/[id]/push — LIVE write: create/update the Shopify
// product from this colorway.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let seasonCode: string | undefined;
  try {
    const body = (await req.json()) as { seasonCode?: string };
    seasonCode = body?.seasonCode;
  } catch {
    /* no body is fine — push without a season scope */
  }
  try {
    const result = await pushColorwayToShopify(id, seasonCode);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push failed" },
      { status: 502 }
    );
  }
}
