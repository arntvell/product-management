import { NextResponse } from "next/server";
import { explain, type EntityType } from "@/lib/master/provenance";

export const dynamic = "force-dynamic";

// GET /api/catalog/explain?entityType=variant&entityId=...
//
// "Why does this value say what it says?" — the authority that decided each
// field, what backs it, and when. Unanswerable before FieldOwner carried an
// authority, which is what made the 122 barcode corrections undefendable from
// the database alone.
const VALID: EntityType[] = ["style", "colorway", "variant"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entityType = url.searchParams.get("entityType") as EntityType | null;
  const entityId = url.searchParams.get("entityId");

  if (!entityType || !VALID.includes(entityType) || !entityId) {
    return NextResponse.json(
      { error: `entityType (${VALID.join(" | ")}) and entityId are required` },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json({ ok: true, entityType, entityId, fields: await explain(entityType, entityId) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
