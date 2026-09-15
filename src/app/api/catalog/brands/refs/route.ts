import { NextResponse } from "next/server";
import { listUnlinkedBrandRefs, linkBrandRef, BrandError } from "@/lib/master/brands";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ refs: await listUnlinkedBrandRefs() });
}

// POST — { refId, brandId?, role? }
export async function POST(req: Request) {
  try {
    const { refId, brandId, role } = await req.json();
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
