import { NextResponse } from "next/server";
import {
  previewShopifyImport,
  runShopifyImport,
} from "@/lib/master/import-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/import/shopify  { dryRun?: boolean, filter?: string }
export async function POST(req: Request) {
  let body: { dryRun?: boolean; filter?: string; vendors?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — defaults apply
  }

  try {
    if (body.dryRun) {
      const preview = await previewShopifyImport(body.filter);
      return NextResponse.json({ dryRun: true, ...preview });
    }
    if (!body.vendors?.length) {
      return NextResponse.json(
        { error: "Select at least one vendor to import." },
        { status: 400 }
      );
    }
    const result = await runShopifyImport(body.vendors, body.filter);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
