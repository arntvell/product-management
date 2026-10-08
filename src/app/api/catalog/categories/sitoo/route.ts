import { NextResponse } from "next/server";
import { CategoryError } from "@/lib/master/categories";
import { linkOrCreateSitooCategory } from "@/lib/master/category-sitoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/catalog/categories/sitoo  { name, parentSitooId?, categoryId?, confirmSimilar? }
//
// Links Sitoo's category of that name under that parent, or creates it in the
// PRODUCTION till. A near-miss name comes back as { ok: false, similar } so the
// form can ask first. `categoryId` also sets that Origo category's Sitoo id.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    parentSitooId?: string | null;
    categoryId?: string | null;
    confirmSimilar?: boolean;
  };
  try {
    return NextResponse.json(
      await linkOrCreateSitooCategory({
        name: body.name ?? "",
        parentSitooId: body.parentSitooId,
        categoryId: body.categoryId,
        confirmSimilar: Boolean(body.confirmSimilar),
      })
    );
  } catch (err) {
    if (err instanceof CategoryError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sitoo category failed" },
      { status: 500 }
    );
  }
}
