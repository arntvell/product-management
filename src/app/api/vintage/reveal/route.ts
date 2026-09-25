import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { revealProducts, HIDE_TAGS } from "@/lib/shopify/reveal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/vintage/reveal  { colorwayIds[] | drop, dryRun? }
//
// Take a pushed drop off the hook: drop the `hide` / `rocket-hide` tags and
// publish to every sales channel. The master's own tags are updated too, so a
// later re-push does not put the hide tags straight back — the Shopify push
// merges tags additively, so a stale `hide` in the master would re-hide a live
// product.
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; drop?: string; dryRun?: boolean };
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
      id: true,
      colorwaySku: true,
      tags: true,
      publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
    },
  });

  const onShopify = rows.filter((r) => r.publications[0]?.externalId);
  const notPushed = rows.filter((r) => !r.publications[0]?.externalId).map((r) => r.colorwaySku);
  if (!onShopify.length)
    return NextResponse.json(
      { error: "None of these are on Shopify yet — push before revealing.", notPushed },
      { status: 422 }
    );

  if (body.dryRun)
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldReveal: onShopify.length,
      tags: HIDE_TAGS,
      notPushed,
    });

  const result = await revealProducts(onShopify.map((r) => r.publications[0]!.externalId!));

  // Keep the master honest. Tags merge additively on push, so leaving `hide`
  // here would re-hide the product the next time anything touched it.
  await prisma.$transaction(
    onShopify.map((r) =>
      prisma.colorway.update({
        where: { id: r.id },
        data: { tags: r.tags.filter((t) => !HIDE_TAGS.includes(t.trim().toLowerCase() as never)) },
      })
    )
  );

  return NextResponse.json({ ok: true, ...result, notPushed });
}
