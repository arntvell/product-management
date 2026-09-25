import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  moveToTopOfCollection,
  waitForMembership,
} from "@/lib/shopify/collection-order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Membership is eventual and the reorder is a job; both are waited on.
export const maxDuration = 300;

// POST /api/vintage/collection/top  { colorwayIds[], dryRun? }
//
// The last step of a drop: put this week's garments at the top of the Vintage
// collection. Membership is NOT arranged here — the collection is rule-based
// on `vendor: "Vintage"`, so the push already did it by setting the vendor.
// What this does is wait for Shopify to have noticed, then reorder.
//
// Order matters twice over: the caller's order becomes the storefront's order,
// and a product Shopify does not yet count as a member cannot be moved.
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = body.colorwayIds ?? [];
  if (!ids.length)
    return NextResponse.json({ error: "colorwayIds is required" }, { status: 400 });

  // Resolve to Shopify product GIDs. A colorway with no publication has not
  // been pushed yet, and reordering it is not a thing that can be attempted.
  const pubs = await prisma.channelPublication.findMany({
    where: { colorwayId: { in: ids }, channel: "SHOPIFY" },
    select: { colorwayId: true, externalId: true },
  });
  const gidByColorway = new Map(
    pubs.filter((p) => p.externalId).map((p) => [p.colorwayId, p.externalId!])
  );
  const notPushed = ids.filter((id) => !gidByColorway.has(id));
  // Preserve the caller's order — it decides what ends up on top.
  const gids = ids.map((id) => gidByColorway.get(id)).filter((g): g is string => !!g);

  if (!gids.length)
    return NextResponse.json(
      { error: "None of these have been pushed to Shopify yet.", notPushed },
      { status: 422 }
    );

  if (body.dryRun)
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldMove: gids.length,
      notPushed,
    });

  try {
    const { members, missing } = await waitForMembership(gids);
    if (!members.length)
      return NextResponse.json(
        {
          error:
            "Shopify does not yet list any of these in the Vintage collection. " +
            "The collection is rule-based on vendor; check the push set vendor \"Vintage\".",
          notInCollection: missing.length,
        },
        { status: 422 }
      );

    const result = await moveToTopOfCollection(members);
    return NextResponse.json({
      ok: true,
      ...result,
      notPushed,
      // Reported, not fatal: the rest of the drop is on top, and a straggler
      // can be moved by running this again.
      notInCollection: missing,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reorder the collection" },
      { status: 500 }
    );
  }
}
