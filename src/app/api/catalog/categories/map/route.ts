import { NextResponse } from "next/server";
import { mapExternalValue, CategoryError } from "@/lib/master/categories";

export const dynamic = "force-dynamic";

// POST /api/catalog/categories/map — { mapId, categoryId }
export async function POST(req: Request) {
  try {
    const { mapId, categoryId } = await req.json();
    await mapExternalValue(mapId, categoryId ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CategoryError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Map failed" },
      { status: 500 }
    );
  }
}
