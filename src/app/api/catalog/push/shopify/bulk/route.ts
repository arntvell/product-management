import { NextResponse } from "next/server";
import { bulkPushToShopify } from "@/lib/master/push-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/shopify/bulk
//   { colorwayIds: string[], seasonCode?, allowIncomplete?, clearEmptied? }
// LIVE write: create/update each colorway's Shopify product. Per-product
// results; one failure never blocks the rest.
//
// clearEmptied defaults to false: a field left blank in the master is left
// alone on Shopify rather than deleted. See pushColorwayToShopify.
export async function POST(req: Request) {
  let body: {
    colorwayIds?: string[];
    seasonCode?: string;
    allowIncomplete?: boolean;
    clearEmptied?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.colorwayIds) || body.colorwayIds.length === 0) {
    return NextResponse.json({ error: "colorwayIds required" }, { status: 400 });
  }

  const results = await bulkPushToShopify(body.colorwayIds, body.seasonCode, {
    allowIncomplete: body.allowIncomplete,
    clearEmptied: body.clearEmptied,
  });
  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({ total: results.length, ok, failed: results.length - ok, results });
}
