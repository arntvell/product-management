import { NextResponse } from "next/server";
import { applyBulkChanges, type BulkChange } from "@/lib/master/edit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/colorways/bulk  { changes: BulkChange[] }
export async function POST(req: Request) {
  let body: { changes?: BulkChange[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  try {
    const result = await applyBulkChanges(body.changes);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Bulk update failed" },
      { status: 500 }
    );
  }
}
