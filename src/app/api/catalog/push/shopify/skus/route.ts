import { NextResponse } from "next/server";
import { pushSkusToShopify, suffixArchivedSkus } from "@/lib/shopify/push-skus";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/shopify/skus
//   { dryRun?, variantIds?, colorwaySkus? }
//
// Renames LIVE Shopify variants to the SKU the master holds, where the two
// differ. Needed because Pio joins central stock on SKU text and has no id to
// fall back to — see src/lib/shopify/push-skus.ts.
export async function POST(req: Request) {
  let body: {
    dryRun?: boolean;
    variantIds?: string[];
    colorwaySkus?: string[];
    /** Instead of renaming live variants, free a SKU an archived one still holds. */
    suffixArchived?: boolean;
    skuPrefixes?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    if (body.suffixArchived) {
      const r = await suffixArchivedSkus({
        dryRun: body.dryRun !== false,
        skuPrefixes: body.skuPrefixes,
      });
      return NextResponse.json({ ok: true, ...r });
    }
    const result = await pushSkusToShopify({
      dryRun: body.dryRun !== false,
      variantIds: body.variantIds,
      colorwaySkus: body.colorwaySkus,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "SKU push failed" },
      { status: 500 }
    );
  }
}
