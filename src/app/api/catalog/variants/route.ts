import { NextResponse } from "next/server";
import { listVariantsForEditor } from "@/lib/master/variant-barcodes";

export const dynamic = "force-dynamic";

// GET /api/catalog/variants?q=&season=&skus=A,B
//
// Rows for the variant editor. `skus` is how pasted corrections pull rows that
// are not on the page yet.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const skus = (url.searchParams.get("skus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const result = await listVariantsForEditor({
      q: url.searchParams.get("q") ?? undefined,
      season: url.searchParams.get("season") ?? undefined,
      skus: skus.length ? skus : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Variant lookup failed" },
      { status: 500 }
    );
  }
}
