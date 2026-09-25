import { NextResponse } from "next/server";
import { getAddSizeContext } from "@/lib/master/add-size";

export const dynamic = "force-dynamic";

// GET /api/catalog/variants/add-size/context?colorwayId=
// The colourway's sizes, the size system(s) it can take new sizes from, and the
// SKU each new size would get.
export async function GET(req: Request) {
  const colorwayId = new URL(req.url).searchParams.get("colorwayId");
  if (!colorwayId) return NextResponse.json({ error: "colorwayId is required" }, { status: 400 });
  try {
    const ctx = await getAddSizeContext(colorwayId);
    if (!ctx) return NextResponse.json({ error: "Colourway not found" }, { status: 404 });
    return NextResponse.json(ctx);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
  }
}
