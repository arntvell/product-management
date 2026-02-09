import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { COLLECTIONS_QUERY } from "@/lib/shopify/queries";
import type { CollectionsQueryResult } from "@/lib/shopify/types";
import type { ShopifyCollection } from "@/types";

export async function GET() {
  try {
    const allCollections: ShopifyCollection[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const result: CollectionsQueryResult =
        await shopifyGraphQL<CollectionsQueryResult>(COLLECTIONS_QUERY, {
          first: 100,
          after: cursor,
        });

      const batch = result.collections.edges.map((edge) => ({
        id: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
        image: edge.node.image,
      }));

      allCollections.push(...batch);
      hasNextPage = result.collections.pageInfo.hasNextPage;
      cursor = result.collections.pageInfo.endCursor;
    }

    return NextResponse.json({ collections: allCollections });
  } catch (error) {
    console.error("Failed to fetch collections:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
