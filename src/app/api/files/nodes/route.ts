import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { NODES_QUERY } from "@/lib/shopify/queries";
import type { NodesQueryResult } from "@/lib/shopify/types";

const BATCH_SIZE = 250;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body as { ids: string[] };

    if (!ids || ids.length === 0) {
      return NextResponse.json({ nodes: [] });
    }

    const allNodes: NodesQueryResult["nodes"] = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const data: NodesQueryResult =
        await shopifyGraphQL<NodesQueryResult>(NODES_QUERY, {
          ids: batch,
        });
      allNodes.push(...data.nodes);
    }

    return NextResponse.json({ nodes: allNodes });
  } catch (error) {
    console.error("Failed to resolve nodes:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
