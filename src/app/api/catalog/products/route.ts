import { NextResponse } from "next/server";
import {
  createExternalProduct,
  ValidationError,
  type CreateProductInput,
} from "@/lib/master/create";

export const dynamic = "force-dynamic";

// POST /api/catalog/products — create an external (manual) product.
export async function POST(req: Request) {
  let body: CreateProductInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await createExternalProduct(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
