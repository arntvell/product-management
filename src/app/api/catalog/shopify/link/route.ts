import { NextResponse } from "next/server";
import { linkShopifyVariants } from "@/lib/shopify/link";

export const dynamic = "force-dynamic";

// POST /api/catalog/shopify/link   { dryRun? }
//
// Records the Shopify VARIANT gid for each Origio variant. The product-level id
// already lives on ChannelPublication; inventory moves per variant, so without
// this there is nothing to move stock against. Archived Shopify products are
// excluded — 7,523 SKUs exist only on archived records, and linking to one would
// point the master at something that cannot receive stock.
export async function POST(req: Request) {
  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    const result = await linkShopifyVariants({ dryRun: body.dryRun });
    return NextResponse.json({ ok: true, dryRun: Boolean(body.dryRun), ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Shopify link failed" },
      { status: 500 }
    );
  }
}
