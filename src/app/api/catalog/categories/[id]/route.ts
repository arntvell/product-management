import { NextResponse } from "next/server";
import { setCategoryFlags, updateCategoryOutbound, CategoryError } from "@/lib/master/categories";

export const dynamic = "force-dynamic";

// PUT /api/catalog/categories/[id] — { active?, archived?, shopifyProductType?,
//                                      loomCategory?, sitooCategoryId? }
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    if (body.active !== undefined || body.archived !== undefined)
      await setCategoryFlags(id, { active: body.active, archived: body.archived });
    if (
      body.shopifyProductType !== undefined ||
      body.loomCategory !== undefined ||
      body.sitooCategoryId !== undefined
    )
      await updateCategoryOutbound(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CategoryError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
