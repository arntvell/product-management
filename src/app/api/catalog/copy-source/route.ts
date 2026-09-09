import { NextResponse } from "next/server";
import { findCopySources } from "@/lib/master/copy-fields-search";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/catalog/copy-source?q=brass&limit=10
// Products whose merchandising fields could be copied onto a selection. Read
// only — searches Shopify and the master, since the older copy lives on Shopify.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), 25)
    : 10;

  try {
    const { sources, warnings } = await findCopySources(q, limit);
    return NextResponse.json({ sources, warnings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
