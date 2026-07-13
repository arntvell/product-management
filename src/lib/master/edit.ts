// Colorway enrichment editing (Phase 2). Writes master-authored fields, manages
// per-channel content overrides (§4.3), and records field ownership so a later
// Threadflow sync skips manually-edited fields (§5.3).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
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

async function runConcurrent(
  ops: Array<Promise<unknown>>,
  concurrency = 15
): Promise<void> {
  for (let i = 0; i < ops.length; i += concurrency) {
    await Promise.all(ops.slice(i, i + concurrency));
  }
}

// ---------------------------------------------------------------------------
// Bulk grid editing: granular per-cell changes across many colorways.
// ---------------------------------------------------------------------------

export type EditLayer = "BASE" | ChannelKey;

export interface BulkChange {
  colorwayId: string;
  field: string; // status | tags | vendor | productType | <SplitFieldKey>
  layer: EditLayer;
  value: string | string[] | null;
}

// Base-layer fields that become MANUAL-owned once edited (§5.3).
const OWNED_BASE_FIELDS = new Set<string>([...SPLIT_FIELD_KEYS, "vendor", "productType"]);

export async function applyBulkChanges(
  changes: BulkChange[]
): Promise<{ colorways: number; changes: number }> {
  const byColorway = new Map<string, BulkChange[]>();
  for (const c of changes) {
    const list = byColorway.get(c.colorwayId) ?? [];
    list.push(c);
    byColorway.set(c.colorwayId, list);
  }

  const ops: Array<Promise<unknown>> = [];

  for (const [colorwayId, list] of byColorway) {
    const baseData: Record<string, unknown> = {};
    const ownerFields: string[] = [];

    for (const ch of list) {
      if (ch.layer === "BASE") {
        if (ch.field === "status") {
          baseData.status = ch.value as ProductStatusValue;
        } else if (ch.field === "tags") {
          const arr = Array.isArray(ch.value)
            ? ch.value
            : String(ch.value ?? "").split(",");
          baseData.tags = arr.map((t) => t.trim()).filter(Boolean);
        } else {
          baseData[ch.field] = norm(
            typeof ch.value === "string" ? ch.value : null
          );
        }
        if (OWNED_BASE_FIELDS.has(ch.field)) ownerFields.push(ch.field);
      } else {
        // Channel override for a split text field.
        const value = norm(typeof ch.value === "string" ? ch.value : null);
        if (value !== null) {
          ops.push(
            prisma.channelContent.upsert({
              where: {
                colorwayId_channel_field: {
                  colorwayId,
                  channel: ch.layer,
                  field: ch.field,
                },
              },
              create: { colorwayId, channel: ch.layer, field: ch.field, value },
              update: { value },
            })
          );
        } else {
          ops.push(
            prisma.channelContent.deleteMany({
              where: { colorwayId, channel: ch.layer, field: ch.field },
            })
          );
        }
      }
    }

    if (Object.keys(baseData).length) {
      ops.push(
        prisma.colorway.update({
          where: { id: colorwayId },
          data: baseData as Prisma.ColorwayUpdateInput,
        })
      );
    }
    for (const field of ownerFields) {
      ops.push(
        prisma.fieldOwner.upsert({
          where: {
            entityType_entityId_field: {
              entityType: "colorway",
              entityId: colorwayId,
              field,
            },
          },
          create: {
            entityType: "colorway",
            entityId: colorwayId,
            field,
            owner: "MANUAL",
            lockedAt: new Date(),
          },
          update: { owner: "MANUAL", lockedAt: new Date() },
        })
      );
    }
  }

  await runConcurrent(ops);
  return { colorways: byColorway.size, changes: changes.length };
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
      vendor: true,
      productType: true,
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
  const nowManual: string[] = SPLIT_FIELD_KEYS.filter(
    (k) => base[k] !== (current[k] ?? null)
  );
  // vendor / productType are Threadflow-derived, so lock them too when edited.
  const newVendor = norm(input.props.vendor);
  const newProductType = norm(input.props.productType);
  if (newVendor !== (current.vendor ?? null)) nowManual.push("vendor");
  if (newProductType !== (current.productType ?? null))
    nowManual.push("productType");

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
