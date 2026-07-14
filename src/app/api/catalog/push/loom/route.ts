import { NextResponse } from "next/server";
import { pushColorwaysToLoom } from "@/lib/loom/push";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/loom  { colorwayIds: string[], seasonCode: string }
// LIVE write to Loom's upsert endpoint.
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; seasonCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.colorwayIds) || !body.colorwayIds.length || !body.seasonCode) {
    return NextResponse.json(
      { error: "colorwayIds and seasonCode are required" },
      { status: 400 }
    );
  }
  try {
    const result = await pushColorwaysToLoom(body.colorwayIds, body.seasonCode);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Loom push failed" },
      { status: 500 }
    );
  }
}
