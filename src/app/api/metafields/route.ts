import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { METAFIELDS_SET_MUTATION } from "@/lib/shopify/mutations";
import type { MetafieldsSetResult } from "@/lib/shopify/types";
import type { BulkMetafieldUpdate } from "@/types";

const BATCH_SIZE = 25;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { updates: BulkMetafieldUpdate[] };
    const { updates } = body;

    if (!updates?.length) {
      return NextResponse.json(
        { error: "No updates provided" },
        { status: 400 }
      );
    }

    // Flatten all metafield inputs
    const allInputs = updates.flatMap((update) =>
      update.metafields.map((mf) => ({
        ownerId: update.productId,
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type,
      }))
    );

    // Process in batches (Shopify limit is 25 metafields per mutation)
    const results: Array<{ success: boolean; errors: string[] }> = [];

    for (let i = 0; i < allInputs.length; i += BATCH_SIZE) {
      const batch = allInputs.slice(i, i + BATCH_SIZE);

      const data = await shopifyGraphQL<MetafieldsSetResult>(
        METAFIELDS_SET_MUTATION,
        { metafields: batch }
      );

      const userErrors = data.metafieldsSet.userErrors;
      if (userErrors.length > 0) {
        results.push({
          success: false,
          errors: userErrors.map((e) => `${e.field.join(".")}: ${e.message}`),
        });
      } else {
        results.push({ success: true, errors: [] });
      }
    }

    const allErrors = results.flatMap((r) => r.errors);
    const allSuccess = allErrors.length === 0;

    return NextResponse.json({
      success: allSuccess,
      batchesProcessed: results.length,
      errors: allErrors,
    });
  } catch (error) {
    console.error("Failed to update metafields:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
