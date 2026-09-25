import { NextResponse } from "next/server";
import { mergeCategories, CategoryError } from "@/lib/master/categories";

export const dynamic = "force-dynamic";

// POST /api/catalog/categories/merge — { loserId, winnerId }
// A tombstone, never a delete. See mergeCategories.
export async function POST(req: Request) {
  try {
    const { loserId, winnerId } = await req.json();
    return NextResponse.json({ ok: true, result: await mergeCategories(loserId, winnerId) });
  } catch (err) {
    if (err instanceof CategoryError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 500 }
    );
  }
}
