import { NextResponse } from "next/server";
import { mergeBrands, suggestBrandDuplicates, BrandError } from "@/lib/master/brands";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ duplicates: await suggestBrandDuplicates() });
}

// POST — { loserId, winnerId }
export async function POST(req: Request) {
  try {
    const { loserId, winnerId } = await req.json();
    return NextResponse.json({ ok: true, result: await mergeBrands(loserId, winnerId) });
  } catch (err) {
    if (err instanceof BrandError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 500 }
    );
  }
}
