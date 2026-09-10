import { NextResponse } from "next/server";
import {
  applyCarryOver,
  previewCarryOver,
  removeFromSeason,
} from "@/lib/master/carry-over";

export const dynamic = "force-dynamic";

// POST /api/catalog/carry-over
//   { colorwayIds, seasonCode, dryRun?, remove?, carryPrices? }
// Carry a selection of products into a season as CARRY-OVER, or take them back
// out. Always preview first (dryRun) — the response says how many will be in
// the season without a price for it, which is the state that fails at push.
export async function POST(req: Request) {
  let body: {
    colorwayIds?: string[];
    seasonCode?: string;
    dryRun?: boolean;
    remove?: boolean;
    carryPrices?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.colorwayIds) ? body.colorwayIds.filter(Boolean) : [];
  const seasonCode = body.seasonCode?.trim();
  if (!ids.length || !seasonCode) {
    return NextResponse.json(
      { error: "colorwayIds and seasonCode are required" },
      { status: 400 }
    );
  }

  try {
    if (body.remove) {
      const result = await removeFromSeason(ids, seasonCode);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.dryRun) {
      const preview = await previewCarryOver(ids, seasonCode);
      return NextResponse.json({ ok: true, dryRun: true, ...preview });
    }
    const result = await applyCarryOver(ids, seasonCode, {
      carryPrices: body.carryPrices,
    });
    return NextResponse.json({ ok: true, dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Carry-over failed" },
      { status: 500 }
    );
  }
}
