import { NextResponse } from "next/server";
import { listColorwaysForStyle } from "@/lib/master/builder-search";

export const dynamic = "force-dynamic";

// GET /api/catalog/builder/colorways?styleId=&q=
export async function GET(req: Request) {
  const url = new URL(req.url);
  const styleId = url.searchParams.get("styleId");
  if (!styleId) return NextResponse.json({ error: "styleId is required" }, { status: 400 });
  const colorways = await listColorwaysForStyle(styleId, url.searchParams.get("q") ?? "");
  return NextResponse.json({ colorways });
}
