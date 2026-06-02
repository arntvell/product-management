import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_VARIANTS_BULK_UPDATE_MUTATION } from "@/lib/shopify/mutations";
import type { ProductVariantsBulkUpdateResult } from "@/lib/shopify/types";

interface PriceUpdate {
  productId: string;
  variantIds: string[];
  price: string;
  compareAtPrice: string | null;
}

export async function POST(request: Request) {
  try {
    const { updates }: { updates: PriceUpdate[] } = await request.json();
    const errors: string[] = [];

    for (const update of updates) {
      const variants = update.variantIds.map((id) => ({
        id,
        price: update.price,
        compareAtPrice: update.compareAtPrice || null,
      }));

      const result = await shopifyGraphQL<ProductVariantsBulkUpdateResult>(
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        { productId: update.productId, variants }
      );

      if (result.productVariantsBulkUpdate.userErrors.length > 0) {
        errors.push(
          ...result.productVariantsBulkUpdate.userErrors.map((e) => e.message)
        );
      }
    }

    return NextResponse.json({ success: errors.length === 0, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
