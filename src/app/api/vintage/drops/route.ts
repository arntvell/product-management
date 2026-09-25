import { NextResponse } from "next/server";
import {
  createVintageItems,
  validateVintageItems,
  VintageError,
  type VintageItemInput,
} from "@/lib/master/vintage-create";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/vintage/drops  { drop, items[], dryRun? }
//
// Create a week's drop. Validation runs on its own when `dryRun` is set, so
// the screen can show every problem in the sheet before anything is written —
// and `createVintageItems` re-runs it regardless, because a route is not the
// only caller and the guarantee belongs with the write.
export async function POST(req: Request) {
  let body: { drop?: string; items?: VintageItemInput[]; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const drop = body.drop?.trim();
  const items = body.items ?? [];
  if (!drop) return NextResponse.json({ error: "drop is required" }, { status: 400 });
  if (!items.length) return NextResponse.json({ error: "No items" }, { status: 400 });

  if (body.dryRun) {
    const problems = validateVintageItems(items);
    return NextResponse.json({
      ok: problems.length === 0,
      dryRun: true,
      wouldCreate: problems.length ? 0 : items.length,
      problems,
    });
  }

  try {
    const result = await createVintageItems(drop, items);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
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
