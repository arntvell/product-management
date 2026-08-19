import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_UPDATE_MUTATION } from "@/lib/shopify/mutations";
import type { ProductUpdateResult } from "@/lib/shopify/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ProductUpdateInput {
  productId: string;
  tags?: string[];
  status?: string;
  vendor?: string;
}

interface RowResult {
  productId: string;
  ok: boolean;
  error?: string;
}

export async function POST(request: Request) {
  let updates: ProductUpdateInput[];
  try {
    ({ updates } = (await request.json()) as { updates: ProductUpdateInput[] });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(updates)) {
    return NextResponse.json({ error: "updates required" }, { status: 400 });
  }

  // Each product is updated independently: one failure never aborts the rest,
  // so a partial success is reported as such instead of failing the whole batch.
  const results: RowResult[] = [];
  for (const update of updates) {
    const input: Record<string, unknown> = { id: update.productId };
    if (update.tags !== undefined) input.tags = update.tags;
    if (update.status !== undefined) input.status = update.status;
    if (update.vendor !== undefined) input.vendor = update.vendor;

    try {
      const result = await shopifyGraphQL<ProductUpdateResult>(
        PRODUCT_UPDATE_MUTATION,
        { input }
      );
      const userErrors = result.productUpdate.userErrors;
      if (userErrors.length > 0) {
        results.push({
          productId: update.productId,
          ok: false,
          error: userErrors.map((e) => e.message).join(", "),
        });
      } else {
        results.push({ productId: update.productId, ok: true });
      }
    } catch (err) {
      results.push({
        productId: update.productId,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({
    success: failed.length === 0,
    total: results.length,
    ok: results.length - failed.length,
    failed: failed.length,
    results,
    // Back-compat flat messages for any existing caller.
    errors: failed.map((r) => `${r.productId}: ${r.error}`),
  });
}
