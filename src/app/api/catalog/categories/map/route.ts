import { NextResponse } from "next/server";
import {
  mapExternalValue,
  linkExactCategoryValues,
  reconcileCategoryOutbound,
  CategoryError,
} from "@/lib/master/categories";

export const dynamic = "force-dynamic";

// POST /api/catalog/categories/map — { mapId, categoryId } to map one, or
// { action: "link-exact", dryRun? } to map every value matching exactly one
// category and take its Sitoo id and Loom word with it.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body?.action === "link-exact") {
      const dryRun = Boolean(body.dryRun);
      const result = await linkExactCategoryValues({ dryRun });
      // Outbound follows the links, always — otherwise a wrong winner stored
      // earlier would survive every later run of the matcher.
      const reconciled = await reconcileCategoryOutbound({ dryRun });
      return NextResponse.json({ ok: true, result, reconciled });
    }
    const { mapId, categoryId } = body;
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
