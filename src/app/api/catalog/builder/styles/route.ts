import { NextResponse } from "next/server";
import { searchStylesForBrand } from "@/lib/master/builder-search";

export const dynamic = "force-dynamic";

// GET /api/catalog/builder/styles?brandId=&q=
// Across ALL seasons — a carry-over is the same style, and season-scoping would
// hide the row the user needs to pick.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId is required" }, { status: 400 });
  const styles = await searchStylesForBrand(brandId, url.searchParams.get("q") ?? "");
  return NextResponse.json({ styles });
}
