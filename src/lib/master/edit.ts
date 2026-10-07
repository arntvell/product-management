// Colorway enrichment editing (Phase 2). Writes master-authored fields, manages
// per-channel content overrides (§4.3), and records field ownership so a later
// Threadflow sync skips manually-edited fields (§5.3).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  CHANNELS,
  OVERRIDE_FIELD_KEYS,
  SPLIT_FIELD_KEYS,
  type ChannelKey,
  type ProductStatusValue,
  type SplitFieldKey,
} from "./fields";

/**
 * A refusal, not a fault: the input asked for something this editor will not do.
 * Separated from a thrown Error so the route can answer 400 — a blank name and a
 * dead database are not the same answer, and a 500 invites a retry that will
 * fail identically.
 */
export class EditValidationError extends Error {}

export interface UpdateColorwayInput {
  props: {
    status: ProductStatusValue;
    tags: string[];
    vendor: string | null;
    productType: string | null;
  };
  base: Partial<Record<SplitFieldKey, string | null>>;
  // Override keys include the text fields plus "tags" (comma-joined string).
  overrides: Partial<Record<ChannelKey, Record<string, string | null>>>;
  /**
   * The name the customer sees. Optional, so every caller that predates it is
   * unchanged and a form that does not show these fields cannot blank them.
   *
   * Two fields, not one, because the channel title is composed from both:
   * `channelProductTitle` returns `Colorway.name` when it already starts with
   * the style and `"<style> <name>"` otherwise. Renaming only the colorway on a
   * product where the two agree — 2,511 of the 2,523 vintage rows — turns
   * "Sunglasses" into "Sunglasses Ray-Ban Aviator" on Shopify and the till.
   */
  identity?: {
    name: string;
    /**
     * Omit to leave the style alone. Refused when the style has more than one
     * colorway: renaming a shared style from one of its colourways' pages
     * silently renames the siblings, which is a different edit made somewhere
     * else. The UI hides the field in that case; this is the guard that holds
     * when the UI is bypassed.
     */
    styleName?: string;
  };
  /**
   * NOK MSRP by SEASON ID. Prices are per-season rows, so there is no single
   * price to edit — a product in two seasons has two. An omitted season is left
   * alone; an empty string deletes that season's row rather than writing 0.
   */
  prices?: Record<string, string | null>;
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
  field: string; // status | tags | vendor | productType | swatchHex | priceNok | <SplitFieldKey>
  layer: EditLayer;
  value: string | string[] | null;
  seasonId?: string; // required for field "priceNok" (prices are per-season)
}

// Base-layer fields that become MANUAL-owned once edited (§5.3).
//
// Status, swatch and the references are here so Refresh from Shopify leaves an
// edit alone: Refresh fills only unlocked fields, so a status changed in the
// grid was reverted to Shopify's before it was ever pushed, and a cleared care
// page or swatch was filled straight back in.
const OWNED_BASE_FIELDS = new Set<string>([
  ...SPLIT_FIELD_KEYS,
  "vendor",
  "productType",
  "name",
  "status",
  "swatchHex",
  "carePageId",
  "fitguidePageId",
  "recommendedCollectionId",
  "modelInfoId",
  "sameProduct",
  "styleWith",
  "styleWithUnisexHerre",
  "styleWithUnisexDame",
]);

// Single-value reference fields (Shopify GIDs); multi-value reference fields
// (master colorway id arrays, carried as JSON strings from the grid).
const SINGLE_REF_FIELDS = new Set<string>([
  "carePageId",
  "fitguidePageId",
  "recommendedCollectionId",
  "modelInfoId",
]);
const MULTI_REF_FIELDS = new Set<string>([
  "sameProduct",
  "styleWith",
  "styleWithUnisexHerre",
  "styleWithUnisexDame",
]);

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

  // A rename needs to know whether the colorway's style is its own. The names
  // are one name on a 1:1 style — 2,506 of the 2,523 vintage styles — and
  // `channelProductTitle` composes "<style> <name>" as soon as they disagree, so
  // moving one without the other turns "Sunglasses" into "Sunglasses Ray-Ban
  // Aviator" on Shopify and the till. Read once for the whole batch rather than
  // per row: a paste down 250 rows is one query either way.
  const renamed = changes.filter((c) => c.field === "name" && c.layer === "BASE");
  const styleOf = new Map<
    string,
    { styleId: string; styleName: string; sole: boolean; name: string }
  >();
  if (renamed.length) {
    const rows = await prisma.colorway.findMany({
      where: { id: { in: [...new Set(renamed.map((c) => c.colorwayId))] } },
      select: {
        id: true,
        name: true,
        styleId: true,
        style: {
          select: { styleName: true, _count: { select: { colorways: true } } },
        },
      },
    });
    for (const r of rows)
      styleOf.set(r.id, {
        styleId: r.styleId,
        styleName: r.style.styleName,
        sole: r.style._count.colorways === 1,
        name: r.name,
      });
  }

  for (const [colorwayId, list] of byColorway) {
    const baseData: Record<string, unknown> = {};
    const ownerFields: string[] = [];

    for (const ch of list) {
      // Price is a per-season Price row, not a Colorway field.
      if (ch.field === "priceNok") {
        const raw = typeof ch.value === "string" ? ch.value.trim() : "";
        if (ch.seasonId && raw) {
          const amount = Number(raw);
          if (!Number.isNaN(amount)) {
            ops.push(
              prisma.price.upsert({
                where: {
                  seasonId_colorwayId_currency_priceType: {
                    seasonId: ch.seasonId,
                    colorwayId,
                    currency: "NOK",
                    priceType: "MSRP",
                  },
                },
                create: {
                  seasonId: ch.seasonId,
                  colorwayId,
                  currency: "NOK",
                  priceType: "MSRP",
                  amount,
                },
                update: { amount },
              })
            );
          }
        }
        continue;
      }
      if (ch.layer === "BASE") {
        if (ch.field === "name") {
          const next = norm(typeof ch.value === "string" ? ch.value : null);
          // A blank cell is not a rename. Skipping rather than throwing is
          // deliberate here: the grid autosaves mid-typing, and a cleared cell
          // on its way to a new value must not fail the whole batch.
          if (!next) continue;
          baseData.name = next;
          ownerFields.push("name");
          const st = styleOf.get(colorwayId);
          // Carried to the style only when this product IS the style. With
          // siblings the style is left alone and the title simply becomes
          // "<style> <new name>", which is what a colour rename should do.
          if (st?.sole && st.styleName !== next)
            ops.push(
              prisma.style.update({
                where: { id: st.styleId },
                data: { styleName: next },
              })
            );
          continue;
        }
        if (ch.field === "status") {
          baseData.status = ch.value as ProductStatusValue;
        } else if (ch.field === "tags") {
          const arr = Array.isArray(ch.value)
            ? ch.value
            : String(ch.value ?? "").split(",");
          baseData.tags = arr.map((t) => t.trim()).filter(Boolean);
        } else if (MULTI_REF_FIELDS.has(ch.field)) {
          // Multi refs arrive as a JSON array string from the grid.
          let ids: string[] = [];
          if (Array.isArray(ch.value)) ids = ch.value;
          else if (typeof ch.value === "string" && ch.value.trim()) {
            try {
              ids = JSON.parse(ch.value);
            } catch {
              ids = [];
            }
          }
          baseData[ch.field] = ids;
        } else if (SINGLE_REF_FIELDS.has(ch.field)) {
          baseData[ch.field] = norm(typeof ch.value === "string" ? ch.value : null);
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
      name: true,
      styleId: true,
      style: {
        select: { styleName: true, _count: { select: { colorways: true } } },
      },
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

  // Identity: the customer-facing name. Validated before anything is written —
  // a blank name is not a rename, and a rename that only half-lands leaves the
  // composed title wrong on every channel.
  const newName = norm(input.identity?.name);
  const renamesColorway = input.identity !== undefined && newName !== current.name;
  if (input.identity !== undefined && !newName)
    throw new EditValidationError("A product name cannot be blank.");

  const newStyleName = norm(input.identity?.styleName);
  const renamesStyle =
    input.identity?.styleName !== undefined &&
    newStyleName !== null &&
    newStyleName !== current.style.styleName;
  if (renamesStyle && current.style._count.colorways > 1)
    throw new EditValidationError(
      `"${current.style.styleName}" has ${current.style._count.colorways} colourways. ` +
        `Renaming the style here would rename all of them — do it on the style page instead.`
    );
  if (input.identity?.styleName !== undefined && newStyleName === null)
    throw new EditValidationError("A style name cannot be blank.");

  // Typed as PrismaPromise so the list can be handed to $transaction below;
  // every entry is a prisma call already.
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  if (renamesStyle) {
    ops.push(
      prisma.style.update({
        where: { id: current.styleId },
        data: { styleName: newStyleName! },
      })
    );
  }

  // Prices are per-season rows on a different table, keyed by season. An
  // omitted season is untouched; a cleared one is DELETED rather than set to 0,
  // because 0 is a price and "no price" is what blocks the readiness gate.
  for (const [seasonId, raw] of Object.entries(input.prices ?? {})) {
    const text = (raw ?? "").trim();
    const key = {
      seasonId_colorwayId_currency_priceType: {
        seasonId,
        colorwayId: id,
        currency: "NOK",
        priceType: "MSRP" as const,
      },
    };
    if (!text) {
      ops.push(prisma.price.deleteMany({ where: { seasonId, colorwayId: id, currency: "NOK", priceType: "MSRP" } }));
      continue;
    }
    const amount = Number(text.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0)
      throw new EditValidationError(`"${text}" is not a price.`);
    ops.push(
      prisma.price.upsert({
        where: key,
        create: { seasonId, colorwayId: id, currency: "NOK", priceType: "MSRP", amount },
        update: { amount },
      })
    );
  }

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
        ...(renamesColorway ? { name: newName! } : {}),
        ...base,
      },
    })
  );

  // 2. Per-channel content overrides (text fields + tags).
  for (const channel of CHANNELS) {
    const chOverrides = input.overrides[channel] ?? {};
    for (const field of OVERRIDE_FIELD_KEYS) {
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

  // 3. Field ownership for changed base fields. `name` joins them when it is
  // edited: nothing in normalize.ts rewrites names today, so this is a record of
  // who chose the value rather than a guard that is currently load-bearing.
  if (renamesColorway) nowManual.push("name");

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

  // One transaction, not Promise.all. A rename is two statements — the style
  // and the colorway — and the composed title is built from both, so landing
  // one without the other is the "Sunglasses Ray-Ban Aviator" state this editor
  // exists to prevent. Everything else here is independent and would be fine
  // either way; two or three statements are nowhere near the 5s timeout that
  // made the reveal transaction a problem.
  await prisma.$transaction(ops);
}
