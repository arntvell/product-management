import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const CHANNELS = ["SHOPIFY", "LOOM"] as const;
type Channel = (typeof CHANNELS)[number];

// PUT /api/catalog/colorways/[id]/channels  { channels: { SHOPIFY: bool, LOOM: bool } }
// Sets which channels the product targets. A row's presence = targeted;
// `published` (set by the actual push) is preserved when a channel stays on.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { channels?: Partial<Record<Channel, boolean>> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const channels = body.channels ?? {};

  await Promise.all(
    CHANNELS.map(async (channel) => {
      if (channels[channel]) {
        await prisma.channelPublication.upsert({
          where: { colorwayId_channel: { colorwayId: id, channel } },
          create: { colorwayId: id, channel, published: false },
          update: {}, // keep published/externalId
        });
      } else {
        await prisma.channelPublication.deleteMany({
          where: { colorwayId: id, channel },
        });
      }
    })
  );

  const publications = await prisma.channelPublication.findMany({
    where: { colorwayId: id },
  });
  return NextResponse.json({ publications });
}
