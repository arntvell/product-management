import { NextResponse } from "next/server";
import { searchColorwaysForAddSize } from "@/lib/master/add-size";

export const dynamic = "force-dynamic";

// GET /api/catalog/variants/add-size/search?q=&brandId=&categoryId=
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const res = await searchColorwaysForAddSize({
      q: url.searchParams.get("q") ?? undefined,
      brandId: url.searchParams.get("brandId") || undefined,
      categoryId: url.searchParams.get("categoryId") || undefined,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}
