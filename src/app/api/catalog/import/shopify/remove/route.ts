import { NextResponse } from "next/server";
import { removeImportedVendors } from "@/lib/master/import-shopify";

export const dynamic = "force-dynamic";

// POST /api/catalog/import/shopify/remove  { vendors: string[] }
// Undo a Shopify import for the given vendors (SHOPIFY_IMPORT products only).
export async function POST(req: Request) {
  let body: { vendors?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.vendors?.length) {
    return NextResponse.json({ error: "No vendors provided" }, { status: 400 });
  }

  try {
    const result = await removeImportedVendors(body.vendors);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Remove failed" },
      { status: 500 }
    );
  }
}
