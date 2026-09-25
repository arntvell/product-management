import { NextResponse } from "next/server";
import { planShopifyCustomsPush, pushCustomsToShopify } from "@/lib/shopify/push-customs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/shopify/customs — { dryRun?, colorwayIds?, limit? }
//
// Writes HS code, country of origin and weight onto Shopify inventory items
// through productVariantsBulkUpdate — NOT productSet, which is declarative and
// would rewrite every other field on the product while it was there.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; colorwayIds?: string[]; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    if (body.dryRun)
      return NextResponse.json({ ok: true, dryRun: true, ...(await planShopifyCustomsPush(body)) });
    const result = await pushCustomsToShopify(body);
    return NextResponse.json({ ok: result.failures.length === 0, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Customs push failed" },
      { status: 500 }
    );
  }
}
