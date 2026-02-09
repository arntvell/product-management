import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { STAGED_UPLOADS_CREATE_MUTATION } from "@/lib/shopify/mutations";
import type { StagedUploadsCreateResult } from "@/lib/shopify/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { files } = body; // Array of { filename, mimeType, fileSize }

    const input = files.map(
      (f: { filename: string; mimeType: string; fileSize: number }) => ({
        filename: f.filename,
        mimeType: f.mimeType,
        resource: "IMAGE",
        fileSize: String(f.fileSize),
        httpMethod: "POST",
      })
    );

    const data = await shopifyGraphQL<StagedUploadsCreateResult>(
      STAGED_UPLOADS_CREATE_MUTATION,
      { input }
    );

    const errors = data.stagedUploadsCreate.userErrors;
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({
      targets: data.stagedUploadsCreate.stagedTargets,
    });
  } catch (error) {
    console.error("Failed to create staged uploads:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
