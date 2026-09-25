import { NextResponse } from "next/server";
import {
  listUnlinkedBrandRefs,
  linkBrandRef,
  linkExactBrandRefs,
  BrandError,
} from "@/lib/master/brands";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ refs: await listUnlinkedBrandRefs() });
}

// POST — { refId, brandId?, role? } to link one, or { action: "link-exact",
// dryRun? } to confirm every value matching exactly one brand.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body?.action === "link-exact")
      return NextResponse.json({
        ok: true,
        result: await linkExactBrandRefs({ dryRun: Boolean(body.dryRun) }),
      });
    const { refId, brandId, role } = body;
    await linkBrandRef(refId, { brandId, role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BrandError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Link failed" },
      { status: 500 }
    );
  }
}
