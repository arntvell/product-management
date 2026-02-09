import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_MEDIA_QUERY } from "@/lib/shopify/queries";
import { PRODUCT_DELETE_MEDIA_MUTATION } from "@/lib/shopify/mutations";
import type {
  ProductMediaQueryResult,
  ProductDeleteMediaResult,
} from "@/lib/shopify/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const decodedId = decodeURIComponent(productId);

    const data = await shopifyGraphQL<ProductMediaQueryResult>(
      PRODUCT_MEDIA_QUERY,
      { id: decodedId, first: 100 }
    );

    const media = data.product.media.edges.map((e) => ({
      id: e.node.id,
      alt: e.node.alt || "",
      mediaContentType: e.node.mediaContentType,
      image: e.node.image || null,
      preview: e.node.preview || null,
    }));

    return NextResponse.json({ media });
  } catch (error) {
    console.error("Failed to fetch media:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const decodedId = decodeURIComponent(productId);
    const body = await request.json();
    const { mediaIds } = body;

    const data = await shopifyGraphQL<ProductDeleteMediaResult>(
      PRODUCT_DELETE_MEDIA_MUTATION,
      { productId: decodedId, mediaIds }
    );

    const errors = data.productDeleteMedia.mediaUserErrors;
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({
      deletedMediaIds: data.productDeleteMedia.deletedMediaIds,
    });
  } catch (error) {
    console.error("Failed to delete media:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
