import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/catalog/colorways/[id]/classify
//   { isCore?: boolean, seasonCode?: string, origin?: "NEW" | "CARRYOVER",
//     remove?: boolean }
// Manually set a product's CORE flag and/or a season entry's NEW/CARRYOVER
// origin, or remove the product from the season entirely. Each manual edit is
// recorded as a MANUAL FieldOwner lock so the automatic classify pass never
// reverts it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: {
    isCore?: boolean;
    seasonCode?: string;
    origin?: "NEW" | "CARRYOVER";
    remove?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body.isCore === "boolean") {
      await prisma.colorway.update({ where: { id }, data: { isCore: body.isCore } });
      await prisma.fieldOwner.upsert({
        where: { entityType_entityId_field: { entityType: "colorway", entityId: id, field: "isCore" } },
        create: { entityType: "colorway", entityId: id, field: "isCore", owner: "MANUAL", lockedAt: new Date() },
        update: { owner: "MANUAL", lockedAt: new Date() },
      });
    }

    // Undoing a carry-over means taking the product back OUT of the season —
    // not relabelling it NEW, which would leave it in scope for that season's
    // push. Drops the MANUAL lock too, so classify is free to decide again.
    if (body.seasonCode && body.remove) {
      const season = await prisma.season.findUnique({
        where: { code: body.seasonCode },
        select: { id: true },
      });
      if (!season) {
        return NextResponse.json(
          { error: `Unknown season ${body.seasonCode}` },
          { status: 404 }
        );
      }
      const entry = await prisma.seasonEntry.findUnique({
        where: { colorwayId_seasonId: { colorwayId: id, seasonId: season.id } },
        select: { id: true },
      });
      if (entry) {
        await prisma.fieldOwner.deleteMany({
          where: { entityType: "seasonEntry", entityId: entry.id, field: "origin" },
        });
        await prisma.seasonEntry.delete({ where: { id: entry.id } });
      }
      return NextResponse.json({ ok: true, removed: !!entry });
    }

    if (body.seasonCode && (body.origin === "NEW" || body.origin === "CARRYOVER")) {
      const season = await prisma.season.findUnique({
        where: { code: body.seasonCode },
        select: { id: true },
      });
      if (!season) {
        // Collections also lists tag-only historical seasons (SS26, FW25 …)
        // that have no Season row; say so instead of a bare "unknown".
        const known = await prisma.season.findMany({
          where: { kind: "REGULAR" },
          select: { code: true },
        });
        return NextResponse.json(
          {
            error: `"${body.seasonCode}" is not a real season, so nothing can be carried into it. Pick one of: ${known
              .map((s) => s.code)
              .join(", ")}.`,
          },
          { status: 404 }
        );
      }
      // Upsert the entry: carry a product into the season even if it isn't in
      // it yet (e.g. promoting a Continuity/older product into the current one).
      const entry = await prisma.seasonEntry.upsert({
        where: { colorwayId_seasonId: { colorwayId: id, seasonId: season.id } },
        create: { colorwayId: id, seasonId: season.id, origin: body.origin },
        update: { origin: body.origin },
        select: { id: true },
      });
      await prisma.fieldOwner.upsert({
        where: { entityType_entityId_field: { entityType: "seasonEntry", entityId: entry.id, field: "origin" } },
        create: { entityType: "seasonEntry", entityId: entry.id, field: "origin", owner: "MANUAL", lockedAt: new Date() },
        update: { owner: "MANUAL", lockedAt: new Date() },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
