import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  nextItemNumbers,
  barcodeForItemNumber,
  itemSku,
  itemVariantSku,
  itemHandle,
  isPreassigned,
} from "@/lib/master/vintage-numbering";
import { highestVintageItemNumber } from "@/lib/shopify/vintage-highest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/vintage/next?count=45
//
// The identities for a new drop, before a word of it is written. Item number,
// SKU, variant SKU, handle and barcode are all computed — none is chosen — so
// the sheet can show them read-only from the start rather than leaving four
// columns that look like someone forgot to fill them in.
export async function GET(req: Request) {
  const count = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("count") ?? 0) || 0, 1),
    300
  );

  // Shopify, not just the master: drops 185-186 were published from the
  // spreadsheet and never imported, so Origio's high-water mark is behind the
  // store's and numbering from it would reuse live numbers.
  const onShopify = await highestVintageItemNumber();
  const next = await nextItemNumbers(prisma, count, { highestOnShopify: onShopify });

  return NextResponse.json({
    ok: true,
    highestUsed: next.highestUsed,
    highestInMaster: next.highestInMaster,
    highestOnShopify: next.highestOnShopify,
    warning: next.warning,
    beyondPreassigned: next.beyondPreassigned,
    items: next.numbers.map((n) => ({
      itemNumber: String(n),
      sku: itemSku(n),
      variantSku: itemVariantSku(n),
      handle: itemHandle(n),
      barcode: barcodeForItemNumber(n),
      preassigned: isPreassigned(n),
    })),
  });
}
