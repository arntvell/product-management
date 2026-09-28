import { NextResponse } from "next/server";
import { bulkPushToShopify } from "@/lib/master/push-shopify";
import { sendChannelIdsToLoom } from "@/lib/master/loom-follow-up";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/push/shopify/bulk
//   { colorwayIds: string[], seasonCode?, allowIncomplete?, clearEmptied? }
// LIVE write: create/update each colorway's Shopify product. Per-product
// results; one failure never blocks the rest. Then every pushed colourway that
// is already in Loom is re-sent to its registry, so Loom learns the
// InventoryItem ids — see loom-follow-up.ts.
//
// clearEmptied defaults to false: a field left blank in the master is left
// alone on Shopify rather than deleted. See pushColorwayToShopify.
export async function POST(req: Request) {
  let body: {
    colorwayIds?: string[];
    seasonCode?: string;
    allowIncomplete?: boolean;
    clearEmptied?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.colorwayIds) || body.colorwayIds.length === 0) {
    return NextResponse.json({ error: "colorwayIds required" }, { status: 400 });
  }

  const results = await bulkPushToShopify(body.colorwayIds, body.seasonCode, {
    allowIncomplete: body.allowIncomplete,
    clearEmptied: body.clearEmptied,
  });
  const ok = results.filter((r) => r.ok).length;
  const loom = await sendChannelIdsToLoom(
    results.filter((r) => r.ok && r.inventoryLinked).map((r) => r.colorwayId),
    { preferSeason: body.seasonCode }
  );
  // Onto the rows, because that is what the callers show — a failure left only
  // in `loom` would reach nobody, which is how this gap went unseen.
  const loomNote = new Map<string, string>();
  for (const s of loom.sends) {
    if (!s.ok)
      for (const id of s.colorwayIds)
        loomNote.set(id, `Loom did not take the Shopify ids (${s.seasonCode}): ${s.error}`);
    for (const k of s.skipped) loomNote.set(k.colorwayId, `Loom skipped the Shopify ids: ${k.reason}`);
  }
  for (const r of results) {
    const note = loomNote.get(r.colorwayId);
    if (note) r.warnings = [...(r.warnings ?? []), note];
  }
  return NextResponse.json({ total: results.length, ok, failed: results.length - ok, results, loom });
}
