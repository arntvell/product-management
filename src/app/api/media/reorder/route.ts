import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_REORDER_MEDIA_MUTATION } from "@/lib/shopify/mutations";
import type { ProductReorderMediaResult } from "@/lib/shopify/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, moves } = body;

    const data = await shopifyGraphQL<ProductReorderMediaResult>(
      PRODUCT_REORDER_MEDIA_MUTATION,
      { id: productId, moves }
    );

    const errors = data.productReorderMedia.mediaUserErrors;
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to reorder media:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
