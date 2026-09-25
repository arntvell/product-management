import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// DELETE /api/vintage/garments/<colorwayId>
//
// Remove a garment that was written up wrongly, so it can be entered again.
// Only ever a correction to work in progress: a garment Shopify already holds
// is refused, because deleting the master's record of a live product does not
// unpublish it, it just loses track of it.
//
// The item number and its barcode are NOT freed. They stay bound to each
// other for the life of the numbering — the barcode may be on a printed label
// already — so re-entering the same number gets the same code back.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const cw = await prisma.colorway.findUnique({
    where: { id },
    select: {
      id: true,
      colorwaySku: true,
      styleId: true,
      brand: { select: { name: true } },
      publications: { select: { channel: true, externalId: true, published: true } },
      style: { select: { id: true, _count: { select: { colorways: true } } } },
    },
  });
  if (!cw) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (cw.brand?.name?.toLowerCase() !== "vintage")
    return NextResponse.json(
      { error: `${cw.colorwaySku} is not a vintage garment.` },
      { status: 422 }
    );

  const live = cw.publications.find((p) => p.channel === "SHOPIFY" && p.externalId);
  if (live)
    return NextResponse.json(
      {
        error:
          `${cw.colorwaySku} is live on Shopify (${live.externalId}). Deleting it here would ` +
          `not unpublish it, only lose track of it. Archive it on Shopify first.`,
      },
      { status: 422 }
    );

  await prisma.$transaction(async (tx) => {
    // FieldOwner is keyed by entityId without a foreign key, so the cascade
    // does not reach it — the locks would outlive the garment and silently
    // apply to nothing.
    await tx.fieldOwner.deleteMany({ where: { entityType: "colorway", entityId: id } });
    // Everything else hangs off Colorway with onDelete: Cascade — variants,
    // media, prices, entries, publications, VintageDetail.
    await tx.colorway.delete({ where: { id } });
    // One garment is its own style; drop it too, unless something else nests
    // under it (Kristoffer's re-nesting put 112 vintage colorways under
    // shared LIV-STY-* styles).
    if (cw.style && cw.style._count.colorways <= 1)
      await tx.style.delete({ where: { id: cw.style.id } }).catch(() => {
        /* a style still in use is not an error */
      });
  });

  return NextResponse.json({ ok: true, deleted: cw.colorwaySku });
}
