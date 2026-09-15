import { NextResponse } from "next/server";
import { checkBrandName } from "@/lib/master/brands";

export const dynamic = "force-dynamic";

// POST /api/catalog/brands/check-name  { name }
//
// Backs the builder's brand picker. An exact normalised collision blocks; a near
// miss warns, because `P.F. Candle` and `P.F. Candles` normalise differently and
// a hard block on similarity would be wrong more often than right.
export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return NextResponse.json(await checkBrandName(body.name ?? ""));
}
