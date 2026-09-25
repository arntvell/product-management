import { NextResponse } from "next/server";
import { listCategoryTree, listUnmapped, createCategory, CategoryError } from "@/lib/master/categories";
import type { RefSystem } from "@/lib/master/reference-pull";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const [categories, unmapped] = await Promise.all([
    listCategoryTree({ includeArchived: url.searchParams.get("includeArchived") === "1" }),
    listUnmapped((url.searchParams.get("system") as RefSystem) || undefined),
  ]);
  return NextResponse.json({ categories, unmapped });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({ ok: true, id: await createCategory(body) }, { status: 201 });
  } catch (err) {
    if (err instanceof CategoryError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
