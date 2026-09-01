import { NextResponse } from "next/server";
import { pushColorwaysToLoom } from "@/lib/loom/push";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/loom
//   { colorwayIds: string[], seasonCode: string, dryRun?: boolean }
// Writes LIVE to Loom's upsert endpoint unless dryRun is set, in which case the
// payload is built and reported but nothing is transmitted or marked published.
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; seasonCode?: string; dryRun?: boolean };
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
    const result = await pushColorwaysToLoom(body.colorwayIds, body.seasonCode, {
      dryRun: body.dryRun,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Loom push failed" },
      { status: 500 }
    );
  }
}
