import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { METAOBJECTS_QUERY } from "@/lib/shopify/queries";
import {
  METAOBJECT_CREATE_MUTATION,
  METAOBJECT_DEFINITION_CREATE_MUTATION,
} from "@/lib/shopify/mutations";
import type {
  MetaobjectsQueryResult,
  MetaobjectMutationResult,
} from "@/lib/shopify/types";
import type { Model } from "@/types";

const MODEL_TYPE = "model";

let definitionEnsured = false;

async function ensureDefinition() {
  if (definitionEnsured) return;

  const data = await shopifyGraphQL<{
    metaobjectDefinitionCreate: {
      metaobjectDefinition: { id: string; type: string } | null;
      userErrors: Array<{ field: string[]; message: string; code: string }>;
    };
  }>(METAOBJECT_DEFINITION_CREATE_MUTATION, {
    definition: {
      type: MODEL_TYPE,
      name: "Model",
      access: {
        storefront: "PUBLIC_READ",
      },
      fieldDefinitions: [
        { key: "name", name: "Name", type: "single_line_text_field" },
        { key: "height", name: "Height", type: "single_line_text_field" },
        { key: "size_worn", name: "Size Worn", type: "single_line_text_field" },
        { key: "notes", name: "Notes", type: "multi_line_text_field" },
      ],
    },
  });

  const errors = data.metaobjectDefinitionCreate.userErrors;
  // "already exists" is fine — means it was created previously
  const alreadyExists = errors.some(
    (e) =>
      e.message.toLowerCase().includes("already exists") ||
      e.code === "TAKEN"
  );

  if (alreadyExists) {
    definitionEnsured = true;
    return;
  }

  if (errors.length > 0) {
    console.error("Failed to create model definition:", errors);
    throw new Error(
      `Failed to create model definition: ${errors.map((e) => e.message).join(", ")}`
    );
  }

  definitionEnsured = true;
}

function parseModel(
  node: MetaobjectsQueryResult["metaobjects"]["edges"][0]["node"]
): Model {
  const fieldMap: Record<string, string> = {};
  for (const f of node.fields) {
    fieldMap[f.key] = f.value;
  }
  return {
    id: node.id,
    handle: node.handle,
    fields: {
      name: fieldMap.name || "",
      height: fieldMap.height || "",
      size_worn: fieldMap.size_worn || "",
      notes: fieldMap.notes || "",
    },
  };
}

export async function GET() {
  try {
    await ensureDefinition();

    const allModels: Model[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const result: MetaobjectsQueryResult =
        await shopifyGraphQL<MetaobjectsQueryResult>(METAOBJECTS_QUERY, {
          type: MODEL_TYPE,
          first: 50,
          after: cursor,
        });

      const batch = result.metaobjects.edges.map((e) => parseModel(e.node));
      allModels.push(...batch);
      hasNextPage = result.metaobjects.pageInfo.hasNextPage;
      cursor = result.metaobjects.pageInfo.endCursor;
    }

    return NextResponse.json({ models: allModels });
  } catch (error) {
    console.error("Failed to fetch models:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDefinition();

    const body = await request.json();
    const { name, height, size_worn, notes } = body;

    const data = await shopifyGraphQL<MetaobjectMutationResult>(
      METAOBJECT_CREATE_MUTATION,
      {
        metaobject: {
          type: MODEL_TYPE,
          fields: [
            { key: "name", value: name },
            { key: "height", value: height || "" },
            { key: "size_worn", value: size_worn || "" },
            { key: "notes", value: notes || "" },
          ],
        },
      }
    );

    const result = data.metaobjectCreate;
    if (result?.userErrors?.length) {
      return NextResponse.json(
        { error: result.userErrors.map((e) => e.message).join(", ") },
        { status: 400 }
      );
    }

    return NextResponse.json({
      model: {
        id: result?.metaobject?.id,
        handle: result?.metaobject?.handle,
      },
    });
  } catch (error) {
    console.error("Failed to create model:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
