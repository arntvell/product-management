import { NextResponse } from "next/server";
import { writeCustoms, type CustomsPatch } from "@/lib/master/customs-write";
import { EDITABLE_FIELDS, type EditableField } from "@/lib/master/fix-list";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/customs
//   { colorwayIds: string[], patch: { manufacturerId?, fiberComposition?, ... } }
// Manual correction of the customs block for one or many products. Every field
// written is locked to MANUAL so enrichment passes cannot revert it.
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; patch?: Record<string, string | null> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.colorwayIds) || !body.colorwayIds.length) {
    return NextResponse.json({ error: "colorwayIds is required" }, { status: 400 });
  }
  if (!body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "patch is required" }, { status: 400 });
  }

  const patch: CustomsPatch = {};
  for (const [k, v] of Object.entries(body.patch)) {
    if (!EDITABLE_FIELDS.includes(k as EditableField)) {
      return NextResponse.json(
        { error: `Unknown field "${k}". Allowed: ${EDITABLE_FIELDS.join(", ")}` },
        { status: 400 }
      );
    }
    patch[k as EditableField] = v;
  }

  try {
    const result = await writeCustoms(body.colorwayIds, patch);
    if (result.skippedUnknownManufacturer) {
      return NextResponse.json(
        { error: `Unknown manufacturer ${result.skippedUnknownManufacturer[0]}` },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
