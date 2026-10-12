import { NextResponse } from "next/server";
import {
  createVintageItems,
  validateVintageItems,
  VintageError,
  type VintageItemInput,
} from "@/lib/master/vintage-create";
import { markCreated, rowsForCreate, DraftError } from "@/lib/vintage/drafts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/vintage/drops  { drop, items[], dryRun?, draftId? }
//
// With draftId, each item names its draft row (rowId) and the item number and
// barcode are taken from the draft as the server numbers it — never from the
// sheet, which may be showing numbers a resize elsewhere has since moved. The
// created rows then leave the draft.
//
// Create a week's drop. Validation runs on its own when `dryRun` is set, so
// the screen can show every problem in the sheet before anything is written —
// and `createVintageItems` re-runs it regardless, because a route is not the
// only caller and the guarantee belongs with the write.
export async function POST(req: Request) {
  let body: {
    drop?: string;
    items?: (VintageItemInput & { rowId?: string })[];
    dryRun?: boolean;
    draftId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let drop = body.drop?.trim();
  let items: VintageItemInput[] = body.items ?? [];
  if (!items.length) return NextResponse.json({ error: "No items" }, { status: 400 });

  const rowIds = (body.items ?? []).map((i) => i.rowId ?? "");
  if (body.draftId) {
    if (rowIds.some((r) => !r)) return NextResponse.json({ error: "Every item needs its rowId" }, { status: 400 });
    try {
      const d = await rowsForCreate(body.draftId, rowIds);
      drop = d.drop;
      items = items.map((i, k) => ({ ...i, itemNumber: d.rows[k].itemNumber, barcode: d.rows[k].barcode }));
    } catch (err) {
      if (err instanceof DraftError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }
  if (!drop) return NextResponse.json({ error: "drop is required" }, { status: 400 });

  try {
    // The dry run goes through `createVintageItems` rather than calling the
    // validator alone, because the validator cannot see the database. "This
    // item number is already in the master" is the one failure an operator
    // cannot spot from the sheet in front of them, and a dry run that misses
    // it only reports at the moment the real create fails.
    const result = await createVintageItems(drop, items, { dryRun: body.dryRun });
    if (body.dryRun)
      return NextResponse.json({
        ok: true,
        dryRun: true,
        wouldCreate: result.created,
        problems: [],
      });
    const left = body.draftId ? await markCreated(body.draftId, rowIds) : null;
    return NextResponse.json({ ok: true, ...result, draftRemaining: left?.remaining ?? null }, { status: 201 });
  } catch (err) {
    if (err instanceof VintageError)
      return NextResponse.json(
        { error: err.message, problems: validateVintageItems(items) },
        { status: 422 }
      );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create the drop" },
      { status: 500 }
    );
  }
}
