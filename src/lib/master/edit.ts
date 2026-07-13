// Colorway enrichment editing (Phase 2). Writes master-authored fields, manages
// per-channel content overrides (§4.3), and records field ownership so a later
// Threadflow sync skips manually-edited fields (§5.3).
import { prisma } from "@/lib/db";
import {
  CHANNELS,
  SPLIT_FIELD_KEYS,
  type ChannelKey,
  type ProductStatusValue,
  type SplitFieldKey,
} from "./fields";

export interface UpdateColorwayInput {
  props: {
    status: ProductStatusValue;
    tags: string[];
    vendor: string | null;
    productType: string | null;
  };
  base: Partial<Record<SplitFieldKey, string | null>>;
  overrides: Partial<Record<ChannelKey, Partial<Record<SplitFieldKey, string | null>>>>;
}

function norm(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function updateColorway(
  id: string,
  input: UpdateColorwayInput
): Promise<void> {
  const current = await prisma.colorway.findUnique({
    where: { id },
    select: {
      shortDescription: true,
      fullDescription: true,
      details: true,
      styleTagline: true,
      styleName: true,
    },
  });
  if (!current) throw new Error("Colorway not found");

  // Base enrichment values (normalised).
  const base: Record<SplitFieldKey, string | null> = {
    shortDescription: norm(input.base.shortDescription),
    fullDescription: norm(input.base.fullDescription),
    details: norm(input.base.details),
    styleTagline: norm(input.base.styleTagline),
    styleName: norm(input.base.styleName),
  };

  // Fields the user actually changed become MANUAL-owned (locked from sync).
  const nowManual: SplitFieldKey[] = SPLIT_FIELD_KEYS.filter(
    (k) => base[k] !== (current[k] ?? null)
  );

  const ops: Promise<unknown>[] = [];

  // 1. Colorway props + base enrichment.
  ops.push(
    prisma.colorway.update({
      where: { id },
      data: {
        status: input.props.status,
        tags: input.props.tags
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
        vendor: norm(input.props.vendor),
        productType: norm(input.props.productType),
        ...base,
      },
    })
  );

  // 2. Per-channel content overrides.
  for (const channel of CHANNELS) {
    const chOverrides = input.overrides[channel] ?? {};
    for (const field of SPLIT_FIELD_KEYS) {
      const value = norm(chOverrides[field]);
      if (value !== null) {
        ops.push(
          prisma.channelContent.upsert({
            where: {
              colorwayId_channel_field: { colorwayId: id, channel, field },
            },
            create: { colorwayId: id, channel, field, value },
            update: { value },
          })
        );
      } else {
        ops.push(
          prisma.channelContent.deleteMany({
            where: { colorwayId: id, channel, field },
          })
        );
      }
    }
  }

  // 3. Field ownership for changed base fields.
  for (const field of nowManual) {
    ops.push(
      prisma.fieldOwner.upsert({
        where: {
          entityType_entityId_field: {
            entityType: "colorway",
            entityId: id,
            field,
          },
        },
        create: {
          entityType: "colorway",
          entityId: id,
          field,
          owner: "MANUAL",
          lockedAt: new Date(),
        },
        update: { owner: "MANUAL", lockedAt: new Date() },
      })
    );
  }

  await Promise.all(ops);
}
