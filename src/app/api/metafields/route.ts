import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import {
  METAFIELDS_SET_MUTATION,
  METAFIELDS_DELETE_MUTATION,
} from "@/lib/shopify/mutations";
import type {
  MetafieldsSetResult,
  MetafieldsDeleteResult,
} from "@/lib/shopify/types";
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

    // Split into sets (non-empty values) and deletes (empty values)
    const setInputs = allInputs.filter((input) => input.value !== "");
    const deleteInputs = allInputs.filter((input) => input.value === "");

    const allErrors: string[] = [];

    // Process sets in batches
    for (let i = 0; i < setInputs.length; i += BATCH_SIZE) {
      const batch = setInputs.slice(i, i + BATCH_SIZE);

      console.log("[metafields] SET batch:", JSON.stringify(batch, null, 2));

      const data = await shopifyGraphQL<MetafieldsSetResult>(
        METAFIELDS_SET_MUTATION,
        { metafields: batch }
      );

      console.log("[metafields] SET result:", JSON.stringify(data, null, 2));

      const userErrors = data.metafieldsSet.userErrors;
      if (userErrors.length > 0) {
        allErrors.push(
          ...userErrors.map((e) => `${e.field.join(".")}: ${e.message}`)
        );
      }
    }

    // Process deletes in batches (metafieldsDelete accepts ownerId+namespace+key)
    if (deleteInputs.length > 0) {
      const deleteIdentifiers = deleteInputs.map((input) => ({
        ownerId: input.ownerId,
        namespace: input.namespace,
        key: input.key,
      }));

      for (let i = 0; i < deleteIdentifiers.length; i += BATCH_SIZE) {
        const batch = deleteIdentifiers.slice(i, i + BATCH_SIZE);

        try {
          const data = await shopifyGraphQL<MetafieldsDeleteResult>(
            METAFIELDS_DELETE_MUTATION,
            { metafields: batch }
          );

          const userErrors = data.metafieldsDelete.userErrors;
          if (userErrors.length > 0) {
            allErrors.push(
              ...userErrors.map((e) => `${e.field.join(".")}: ${e.message}`)
            );
          }
        } catch (err) {
          allErrors.push(
            `Failed to clear metafields: ${err instanceof Error ? err.message : "Unknown error"}`
          );
        }
      }
    }

    return NextResponse.json({
      success: allErrors.length === 0,
      batchesProcessed:
        Math.ceil(setInputs.length / BATCH_SIZE) +
        Math.ceil(deleteInputs.length / BATCH_SIZE),
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
