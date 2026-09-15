import { NextResponse } from "next/server";
import {
  getBrandSettings,
  saveBrandSettings,
  BrandError,
  type SaveBrandSettingsInput,
} from "@/lib/master/brands";

export const dynamic = "force-dynamic";

// GET  /api/catalog/brands/[id] — settings, including the SKU token and what
//      the abbreviation rule would derive without it.
// PUT  /api/catalog/brands/[id] — { skuToken?, template? }
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const settings = await getBrandSettings(id);
  if (!settings) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  return NextResponse.json({ settings });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: SaveBrandSettingsInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await saveBrandSettings(id, body);
    return NextResponse.json({ ok: true, settings: await getBrandSettings(id) });
  } catch (err) {
    if (err instanceof BrandError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}
