import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_CREATE_MEDIA_MUTATION } from "@/lib/shopify/mutations";
import type { ProductCreateMediaResult } from "@/lib/shopify/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, resourceUrls } = body;

    const media = resourceUrls.map((url: string) => ({
      originalSource: url,
      mediaContentType: "IMAGE",
    }));

    const data = await shopifyGraphQL<ProductCreateMediaResult>(
      PRODUCT_CREATE_MEDIA_MUTATION,
      { productId, media }
    );

    const errors = data.productCreateMedia.mediaUserErrors;
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({
      media: data.productCreateMedia.media,
    });
  } catch (error) {
    console.error("Failed to confirm media upload:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
