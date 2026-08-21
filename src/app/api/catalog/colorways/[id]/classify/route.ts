import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/catalog/colorways/[id]/classify
//   { isCore?: boolean, seasonCode?: string, origin?: "NEW" | "CARRYOVER" }
// Manually set a product's CORE flag and/or a season entry's NEW/CARRYOVER
// origin. Each manual edit is recorded as a MANUAL FieldOwner lock so the
// automatic classify pass never reverts it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { isCore?: boolean; seasonCode?: string; origin?: "NEW" | "CARRYOVER" };
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

    if (body.seasonCode && (body.origin === "NEW" || body.origin === "CARRYOVER")) {
      const entry = await prisma.seasonEntry.findFirst({
        where: { colorwayId: id, season: { code: body.seasonCode } },
        select: { id: true },
      });
      if (!entry) {
        return NextResponse.json(
          { error: `No ${body.seasonCode} entry for this product` },
          { status: 404 }
        );
      }
      await prisma.seasonEntry.update({ where: { id: entry.id }, data: { origin: body.origin } });
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
