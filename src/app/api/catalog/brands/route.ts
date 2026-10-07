import { NextResponse } from "next/server";
import { BrandError } from "@/lib/master/brands";
import { createBrand } from "@/lib/master/brand-create";

export const dynamic = "force-dynamic";

// POST /api/catalog/brands  { name, skuToken?, confirmSimilar? }
//
// Creates an external brand. An exact name clash is a 422; a near miss comes
// back as { ok: false, similar } so the form can ask before creating.
export async function POST(req: Request) {
  let body: { name?: string; skuToken?: string | null; confirmSimilar?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await createBrand({
        name: body.name ?? "",
        skuToken: body.skuToken,
        confirmSimilar: Boolean(body.confirmSimilar),
      })
    );
  } catch (err) {
    if (err instanceof BrandError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
