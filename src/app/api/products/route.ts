import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCTS_QUERY } from "@/lib/shopify/queries";
import { PRODUCTS_PER_PAGE, METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { ProductsQueryResult } from "@/lib/shopify/types";
import type { Product, ProductMetafields } from "@/types";

export async function GET() {
  try {
    const allProducts: Product[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const data: ProductsQueryResult =
        await shopifyGraphQL<ProductsQueryResult>(PRODUCTS_QUERY, {
          first: PRODUCTS_PER_PAGE,
          after: cursor,
        });

      const products = data.products.edges.map((edge) => {
        const node = edge.node;

        const metafields: ProductMetafields = {
          short_description: "",
          full_description: "",
          details: "",
          same_product: "",
          style_with: "",
          flat: "",
          care: "",
          fitguide: "",
          model_info: "",
          recommended_collection: "",
          style_with_unisex_herre: "",
          style_with_unisex_dame: "",
          men_images: "",
          women_images: "",
        };

        for (const mfEdge of node.metafields.edges) {
          const mf = mfEdge.node;
          const def = METAFIELD_DEFINITIONS.find(
            (d) => d.key === mf.key && d.namespace === mf.namespace
          );
          if (def) {
            metafields[def.key] = mf.value;
          }
        }

        return {
          id: node.id,
          title: node.title,
          handle: node.handle,
          vendor: node.vendor,
          productType: node.productType,
          tags: node.tags,
          status: (node.status || "ACTIVE") as Product["status"],
          featuredImage: node.featuredImage?.url || null,
          mediaCount: node.mediaCount?.count ?? 0,
          metafields,
        } satisfies Product;
      });

      allProducts.push(...products);
      hasNextPage = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
    }

    return NextResponse.json({ products: allProducts });
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
