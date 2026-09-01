import { NextResponse } from "next/server";
import {
  buildProductsForBrand,
  ValidationError,
  type BuildProductsInput,
} from "@/lib/master/create";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/products/build — create many products for a brand.
export async function POST(req: Request) {
  let body: BuildProductsInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await buildProductsForBrand(body);
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
