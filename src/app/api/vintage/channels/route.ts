import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { revealProducts } from "@/lib/shopify/reveal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/vintage/channels  { drop | colorwayIds[], dryRun? }
//
// Put a pushed drop on the sales channels, while it is still hidden by its
// tags. Run straight after the Shopify push, not at reveal.
//
// WHY NOT AT REVEAL. `productSet` sets status but does not publish, so a
// pushed garment is ACTIVE and carried by no channel — a state nothing else in
// the store produces, and one that any feed or app reading the catalogue sees
// as a product belonging nowhere. The spreadsheet never left products there:
// Matrixify set `Published = True` AND the hide tags, so a garment was on the
// channels from the moment it existed and the tags did the hiding.
//
// It also moves the work off the critical moment. Publishing 40 garments to 5
// channels is 200 mutations; doing that at reveal means the drop opening
// depends on all of them landing at once, which is exactly when there is no
// time to fix anything. Done at push, a failure is noticed hours early, and
// reveal becomes 40 cheap tag removals.
export async function POST(req: Request) {
  let body: { drop?: string; colorwayIds?: string[]; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const where = body.drop?.trim()
    ? { entries: { some: { drop: body.drop.trim() } } }
    : { id: { in: body.colorwayIds ?? [] } };
  if (!body.drop?.trim() && !body.colorwayIds?.length)
    return NextResponse.json({ error: "Pass a drop or colorwayIds" }, { status: 400 });

  const rows = await prisma.colorway.findMany({
    where,
    select: {
      colorwaySku: true,
      publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
    },
  });
  const gids = rows.map((r) => r.publications[0]?.externalId).filter((g): g is string => !!g);
  const notPushed = rows.filter((r) => !r.publications[0]?.externalId).map((r) => r.colorwaySku);

  if (!gids.length)
    return NextResponse.json(
      { error: "None of these are on Shopify yet — push first.", notPushed },
      { status: 422 }
    );

  if (body.dryRun)
    return NextResponse.json({ ok: true, dryRun: true, wouldPublish: gids.length, notPushed });

  // Tags are left alone: this stages the drop, it does not open it.
  const result = await revealProducts(gids, { removeTags: false, publish: true });

  return NextResponse.json({
    ok: true,
    published: result.published.length,
    requested: gids.length,
    notPushed,
    warnings: result.warnings,
  });
}
