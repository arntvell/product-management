import { NextResponse } from "next/server";
import { backfillProductKind } from "@/lib/master/product-kind";

export const dynamic = "force-dynamic";

// POST /api/catalog/classify-kind   { dryRun? }
//
// Sets Colorway.kind across the catalogue, moving the merchandise/material/
// aggregate distinction out of reconcile.py and into the master. Every write is
// attributed through FieldOwner, so the rule that produced it stays visible.
export async function POST(req: Request) {
  let body: { dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    const result = await backfillProductKind({ dryRun: body.dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Classification failed" },
      { status: 500 }
    );
  }
}
