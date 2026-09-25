// Which channels a colorway is actually SOLD on, as a fact the master records
// rather than one every consumer re-derives.
//
// Origio has always known this twice over and written it down once. A colorway
// carries ChannelPublication rows — presence means "targeted at this channel" —
// and its variants carry VariantChannelRef rows, minted by the linkers when they
// match a garment to the product that represents it in Shopify or Sitoo. The
// second is evidence; the first is the declaration. For Shopify they agree: 2 406
// colorways linked, 2 406 with a publication row, none linked without one,
// because pushColorwayToShopify writes the publication itself.
//
// For Sitoo they did not. The Sitoo linker had matched 8 089 variants across
// 2 265 colorways and there were ZERO ChannelPublication(SITOO) rows — the
// membership fact existed in the database and no code had ever turned it into a
// declaration. Which is why Loom, whose stock hub is the only link between the
// five stores' Sitoo stock and their Shopify locations, could not tell a jeans
// style missing its Shopify link (a real, fixable gap) from a store-only
// accessory that was never meant to have one. On 2026-09-18 that produced 2 049
// `no_inventory_item` failures, mostly of the second kind.
//
// ONE DIRECTION ONLY. This adds publications where evidence exists; it never
// removes one. A withdrawal has to be deliberate, because of what the flag means
// downstream: `sitoo: false` tells Loom to SUPPRESS stock errors for that
// product, so inferring it from a linker run that happened to read a partial
// catalogue would switch off error reporting for live garments and look like an
// improvement. Loom applies the same rule to its own inference — a truncated
// sweep records nothing. Untargeting is what the channel editor is for.

import { prisma } from "@/lib/db";
import type { Channel } from "@/generated/prisma/enums";

export interface MembershipSyncResult {
  /** Publication rows created from link evidence. */
  created: number;
  /** Colorways that already had one. */
  alreadyDeclared: number;
  /**
   * Declared in the channel but with no surviving variant link.
   *
   * Reported, never acted on. It is the interesting list — either the product
   * was withdrawn from the channel and nobody untargeted it here, or its ids
   * went stale and the linker could not re-point them — but both readings need a
   * person, and the wrong one silences a real error.
   */
  declaredWithoutLink: string[];
}

/**
 * Bring ChannelPublication into line with the link evidence for one channel.
 *
 * Safe to run repeatedly: the insert is guarded on the row not already existing,
 * so a second run is a no-op and reports `created: 0`.
 */
export async function syncChannelMembership(
  channel: Extract<Channel, "SHOPIFY" | "SITOO">,
  opts: { dryRun?: boolean } = {}
): Promise<MembershipSyncResult> {
  const linked = await prisma.$queryRaw<Array<{ colorwayId: string }>>`
    SELECT DISTINCT v."colorwayId"
    FROM "Variant" v
    JOIN "VariantChannelRef" r ON r."variantId" = v.id AND r.channel = ${channel}::"Channel"
  `;
  const declared = await prisma.channelPublication.findMany({
    where: { channel },
    select: { colorwayId: true },
  });

  const linkedIds = new Set(linked.map((r) => r.colorwayId));
  const declaredIds = new Set(declared.map((p) => p.colorwayId));
  const missing = [...linkedIds].filter((id) => !declaredIds.has(id));

  if (!opts.dryRun && missing.length) {
    // `published` stays false, and correctly so. It means "a push wrote this",
    // and nothing was pushed here — the linker only found what was already in
    // the channel. That is the same state the Shopify linker leaves behind, which
    // is why only 72 of 2 408 Shopify rows are published while every one of them
    // is a real listing. The Loom feed reads row presence, not this column.
    await prisma.channelPublication.createMany({
      data: missing.map((colorwayId) => ({ colorwayId, channel, published: false })),
      skipDuplicates: true,
    });
  }

  return {
    created: missing.length,
    alreadyDeclared: linkedIds.size - missing.length,
    declaredWithoutLink: [...declaredIds].filter((id) => !linkedIds.has(id)),
  };
}

/**
 * Declare a channel for colorways a push has just written to.
 *
 * Narrower than the sweep above and used on the create path, where the evidence
 * is the push's own outcome rather than a catalogue read.
 */
export async function declareChannel(
  colorwayIds: string[],
  channel: Channel
): Promise<void> {
  if (!colorwayIds.length) return;
  await prisma.channelPublication.createMany({
    data: colorwayIds.map((colorwayId) => ({ colorwayId, channel, published: false })),
    skipDuplicates: true,
  });
}
