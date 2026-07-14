import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/channels/bulk
//   { colorwayIds: string[], channel: "SHOPIFY"|"LOOM", action: "target"|"untarget" }
// Targets or untargets a channel for many colorways at once.
export async function POST(req: Request) {
  let body: {
    colorwayIds?: string[];
    channel?: "SHOPIFY" | "LOOM";
    action?: "target" | "untarget";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { colorwayIds, channel, action } = body;
  if (!Array.isArray(colorwayIds) || !colorwayIds.length || !channel || !action) {
    return NextResponse.json(
      { error: "colorwayIds, channel and action are required" },
      { status: 400 }
    );
  }

  if (action === "target") {
    // createMany skipDuplicates keeps existing rows (and their published state).
    await prisma.channelPublication.createMany({
      data: colorwayIds.map((colorwayId) => ({
        colorwayId,
        channel,
        published: false,
      })),
      skipDuplicates: true,
    });
  } else {
    await prisma.channelPublication.deleteMany({
      where: { colorwayId: { in: colorwayIds }, channel },
    });
  }

  return NextResponse.json({ ok: true, count: colorwayIds.length });
}
