import { NextResponse } from "next/server";
import { bulkPushToShopify } from "@/lib/master/push-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/shopify/bulk  { colorwayIds: string[] }
// LIVE write: create/update each colorway's Shopify product. Per-product
// results; one failure never blocks the rest.
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; seasonCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.colorwayIds) || body.colorwayIds.length === 0) {
    return NextResponse.json({ error: "colorwayIds required" }, { status: 400 });
  }

  const results = await bulkPushToShopify(body.colorwayIds, body.seasonCode);
  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({ total: results.length, ok, failed: results.length - ok, results });
}
