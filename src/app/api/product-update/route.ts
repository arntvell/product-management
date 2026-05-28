import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_UPDATE_MUTATION } from "@/lib/shopify/mutations";
import type { ProductUpdateResult } from "@/lib/shopify/types";

interface ProductUpdateInput {
  productId: string;
  tags?: string[];
  status?: string;
  vendor?: string;
}

export async function POST(request: Request) {
  try {
    const { updates } = (await request.json()) as {
      updates: ProductUpdateInput[];
    };
    const errors: string[] = [];

    for (const update of updates) {
      const input: Record<string, unknown> = { id: update.productId };
      if (update.tags !== undefined) input.tags = update.tags;
      if (update.status !== undefined) input.status = update.status;
      if (update.vendor !== undefined) input.vendor = update.vendor;

      const result = await shopifyGraphQL<ProductUpdateResult>(
        PRODUCT_UPDATE_MUTATION,
        { input }
      );

      if (result.productUpdate.userErrors.length > 0) {
        errors.push(...result.productUpdate.userErrors.map((e) => e.message));
      }
    }

    return NextResponse.json({ success: errors.length === 0, errors });
  } catch (error) {
    console.error("Failed to update products:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
