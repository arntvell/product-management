import { NextResponse } from "next/server";
import { pushColorwayToShopify } from "@/lib/master/push-shopify";
import { describeLoomFollowUp, sendChannelIdsToLoom } from "@/lib/master/loom-follow-up";

export const dynamic = "force-dynamic";
// The Shopify push, then one Loom submit (not waited on).
export const maxDuration = 120;

// POST /api/catalog/colorways/[id]/push — LIVE write: create/update the Shopify
// product from this colorway, then re-send it to Loom's registry if it is
// already there, so Loom learns the InventoryItem ids this push returned.
//
// clearEmptied defaults to false: a field left blank in the master is left alone
// on Shopify rather than deleted. See pushColorwayToShopify.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let seasonCode: string | undefined;
  let allowIncomplete = false;
  let clearEmptied = false;
  try {
    const body = (await req.json()) as {
      seasonCode?: string;
      allowIncomplete?: boolean;
      clearEmptied?: boolean;
    };
    seasonCode = body?.seasonCode;
    allowIncomplete = !!body?.allowIncomplete;
    clearEmptied = !!body?.clearEmptied;
  } catch {
    /* no body is fine — push without a season scope */
  }
  try {
    const result = await pushColorwayToShopify(id, seasonCode, allowIncomplete, clearEmptied);
    // Only when ids were actually recorded: a failed recording is already a
    // warning, and re-sending would carry the same gap.
    if (!result.variantRefs?.inventoryLinked) return NextResponse.json(result);
    const loom = await sendChannelIdsToLoom([id], { preferSeason: seasonCode });
    const note = describeLoomFollowUp(loom);
    return NextResponse.json({
      ...result,
      warnings: note ? [...result.warnings, note] : result.warnings,
      loom,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push failed" },
      { status: 502 }
    );
  }
}
