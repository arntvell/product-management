import { NextResponse } from "next/server";
import { previewShopifyEnrichment, runShopifyEnrichment } from "@/lib/master/enrich-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/enrich/shopify  { dryRun?: boolean }
// Enrich CIN7_IMPORT colorways with Shopify tags/vendor/product-type.
export async function POST(req: Request) {
  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  try {
    if (body.dryRun) {
      const preview = await previewShopifyEnrichment();
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await runShopifyEnrichment();
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}
