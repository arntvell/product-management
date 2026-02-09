import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PAGES_QUERY } from "@/lib/shopify/queries";
import type { PagesQueryResult } from "@/lib/shopify/types";
import type { ShopifyPage } from "@/types";

export async function GET() {
  try {
    const allPages: ShopifyPage[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const result: PagesQueryResult =
        await shopifyGraphQL<PagesQueryResult>(PAGES_QUERY, {
          first: 100,
          after: cursor,
        });

      const batch = result.pages.edges.map((edge) => ({
        id: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
        bodySummary: edge.node.bodySummary,
      }));

      allPages.push(...batch);
      hasNextPage = result.pages.pageInfo.hasNextPage;
      cursor = result.pages.pageInfo.endCursor;
    }

    return NextResponse.json({ pages: allPages });
  } catch (error) {
    console.error("Failed to fetch pages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
