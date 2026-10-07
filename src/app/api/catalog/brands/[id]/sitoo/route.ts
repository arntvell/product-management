import { NextResponse } from "next/server";
import { BrandError } from "@/lib/master/brands";
import { getBrandSitooState, linkOrCreateSitooManufacturer } from "@/lib/master/brand-create";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // reads every Sitoo manufacturer before creating

// GET  /api/catalog/brands/[id]/sitoo — { configured, links }
// POST /api/catalog/brands/[id]/sitoo  { confirmSimilar? }
//      Links the Sitoo manufacturer with this brand's name, or creates it in the
//      PRODUCTION till. Near-miss names come back as { ok: false, similar }.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await getBrandSitooState(id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { confirmSimilar?: boolean };
  try {
    return NextResponse.json(
      await linkOrCreateSitooManufacturer(id, { confirmSimilar: Boolean(body.confirmSimilar) })
    );
  } catch (err) {
    if (err instanceof BrandError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sitoo link failed" },
      { status: 500 }
    );
  }
}
