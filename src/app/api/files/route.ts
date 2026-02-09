import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { FILE_CREATE_MUTATION } from "@/lib/shopify/mutations";
import type { FileCreateResult } from "@/lib/shopify/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { resourceUrls } = body as { resourceUrls: string[] };

    const files = resourceUrls.map((url: string) => ({
      originalSource: url,
      contentType: "IMAGE",
    }));

    const data = await shopifyGraphQL<FileCreateResult>(
      FILE_CREATE_MUTATION,
      { files }
    );

    const errors = data.fileCreate.userErrors;
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({
      files: data.fileCreate.files,
    });
  } catch (error) {
    console.error("Failed to create files:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
