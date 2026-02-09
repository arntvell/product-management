import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import {
  METAOBJECT_UPDATE_MUTATION,
  METAOBJECT_DELETE_MUTATION,
} from "@/lib/shopify/mutations";
import type { MetaobjectMutationResult } from "@/lib/shopify/types";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, height, size_worn, notes } = body;

    // The id comes URL-encoded; decode it
    const decodedId = decodeURIComponent(id);

    const data = await shopifyGraphQL<MetaobjectMutationResult>(
      METAOBJECT_UPDATE_MUTATION,
      {
        id: decodedId,
        metaobject: {
          fields: [
            { key: "name", value: name },
            { key: "height", value: height || "" },
            { key: "size_worn", value: size_worn || "" },
            { key: "notes", value: notes || "" },
          ],
        },
      }
    );

    const result = data.metaobjectUpdate;
    if (result?.userErrors?.length) {
      return NextResponse.json(
        { error: result.userErrors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update model:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);

    const data = await shopifyGraphQL<MetaobjectMutationResult>(
      METAOBJECT_DELETE_MUTATION,
      { id: decodedId }
    );

    const result = data.metaobjectDelete;
    if (result?.userErrors?.length) {
      return NextResponse.json(
        { error: result.userErrors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete model:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
