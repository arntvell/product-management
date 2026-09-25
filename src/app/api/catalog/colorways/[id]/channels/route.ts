import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// SITOO belongs here for the same reason SHOPIFY does: Loom's stock hub reads
// these rows to tell a missing channel link apart from a product that was never
// meant to be sold there, and a channel an operator cannot untarget is a channel
// whose `false` can only ever be guessed. It was omitted while Sitoo membership
// existed nowhere but the linker's variant refs.
const CHANNELS = ["SHOPIFY", "LOOM", "SITOO"] as const;
type Channel = (typeof CHANNELS)[number];

// PUT /api/catalog/colorways/[id]/channels
//   { channels: { SHOPIFY?: bool, LOOM?: bool, SITOO?: bool } }
//
// Sets which channels the product targets. A row's presence = targeted;
// `published` (set by the actual push) is preserved when a channel stays on.
//
// ABSENT MEANS KEEP. A key the caller did not send changes nothing. This used to
// iterate a fixed two-channel list and delete anything not explicitly true, so
// adding SITOO to that list would have made every toggle in the colorway panel —
// which sends SHOPIFY and LOOM only — silently withdraw the product from Sitoo,
// and a withdrawal here tells Loom to stop reporting that product's stock
// errors. It is the same rule Loom applies to the flags we send it, for the same
// reason: a partial update must never be readable as a withdrawal.
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
      if (channels[channel] === undefined) return;
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
