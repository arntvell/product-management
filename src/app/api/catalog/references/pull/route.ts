import { NextResponse } from "next/server";
import { pullAllReferences } from "@/lib/master/reference-pull";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/references/pull — { dryRun?, sitooTarget? }
//
// Read-only against the channels; writes only the review queue. Sitoo defaults
// to whatever SITOO_TARGET says, which is sandbox in local development — pass
// sitooTarget explicitly when you mean production.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; sitooTarget?: "production" | "sandbox" } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    const report = await pullAllReferences(body);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pull failed" },
      { status: 500 }
    );
  }
}
