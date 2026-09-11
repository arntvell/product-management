import { NextResponse } from "next/server";
import { planShopifyBarcodePush, pushBarcodesToShopify } from "@/lib/shopify/push-barcodes";

export const dynamic = "force-dynamic";

// POST /api/catalog/push/shopify/barcodes   { dryRun?, variantIds? }
//
// Writes corrected barcodes to Shopify variants that already exist. Nothing is
// created. Unlike Sitoo, Shopify does not enforce barcode uniqueness — it holds
// 41 barcodes on more than one live variant today — so the plan refuses any
// write that would put one code on two variants rather than relying on the API
// to reject it.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; variantIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    if (body.dryRun) {
      const plan = await planShopifyBarcodePush({ variantIds: body.variantIds });
      return NextResponse.json({ ok: true, dryRun: true, ...plan });
    }
    const result = await pushBarcodesToShopify({ variantIds: body.variantIds });
    return NextResponse.json({ ok: result.failures.length === 0, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Shopify barcode push failed" },
      { status: 500 }
    );
  }
}
