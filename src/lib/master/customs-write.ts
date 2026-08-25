// Manual writes to a product's customs block.
//
// Everything written here is a human decision, so each field is recorded as a
// MANUAL FieldOwner lock — the Cin7/Shopify enrichment passes and the classify
// pass all skip MANUAL-locked fields, so a correction is never silently undone
// by a later re-run.
//
// Values are written as COLORWAY OVERRIDES rather than onto the style: several
// colorways can share a style, and a correction to one colour must not silently
// rewrite its siblings.
import { prisma } from "@/lib/db";
import type { EditableField } from "./fix-list";

export type CustomsPatch = Partial<Record<EditableField, string | null>>;

const OVERRIDE_COLUMN: Record<Exclude<EditableField, "manufacturerId" | "countryOfOrigin">, string> = {
  fiberComposition: "fiberCompositionOverride",
  customsDescription: "customsDescriptionOverride",
  hsCode: "hsCodeOverride",
  weightKg: "weightKgOverride",
};

export interface CustomsWriteResult {
  updated: number;
  fields: string[];
  skippedUnknownManufacturer?: string[];
}

function buildData(patch: CustomsPatch): {
  data: Record<string, unknown>;
  fields: EditableField[];
} {
  const data: Record<string, unknown> = {};
  const fields: EditableField[] = [];
  for (const [key, raw] of Object.entries(patch) as [EditableField, string | null][]) {
    if (raw === undefined) continue;
    const value = typeof raw === "string" && raw.trim() === "" ? null : raw;
    if (key === "manufacturerId") {
      data.manufacturerId = value;
    } else if (key === "countryOfOrigin") {
      data.countryOfOrigin = value;
    } else if (key === "weightKg") {
      if (value === null) data.weightKgOverride = null;
      else {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) continue; // ignore junk rather than store it
        data.weightKgOverride = n;
      }
    } else {
      data[OVERRIDE_COLUMN[key as keyof typeof OVERRIDE_COLUMN]] = value;
    }
    fields.push(key);
  }
  return { data, fields };
}

/** Apply the same patch to one or more colorways, locking every field written. */
export async function writeCustoms(
  colorwayIds: string[],
  patch: CustomsPatch
): Promise<CustomsWriteResult> {
  const { data, fields } = buildData(patch);
  if (!fields.length || !colorwayIds.length) return { updated: 0, fields: [] };

  // A manufacturer must exist — otherwise the write would silently null it.
  if (fields.includes("manufacturerId") && data.manufacturerId) {
    const found = await prisma.manufacturer.findUnique({
      where: { id: String(data.manufacturerId) },
      select: { id: true },
    });
    if (!found) {
      return {
        updated: 0,
        fields: [],
        skippedUnknownManufacturer: [String(data.manufacturerId)],
      };
    }
  }

  const now = new Date();
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < colorwayIds.length; i += CHUNK) {
    const chunk = colorwayIds.slice(i, i + CHUNK);
    const res = await prisma.colorway.updateMany({ where: { id: { in: chunk } }, data });
    updated += res.count;
    // Lock each written field so automated passes leave the correction alone.
    await prisma.$transaction(
      chunk.flatMap((entityId) =>
        fields.map((field) =>
          prisma.fieldOwner.upsert({
            where: {
              entityType_entityId_field: { entityType: "colorway", entityId, field },
            },
            create: {
              entityType: "colorway",
              entityId,
              field,
              owner: "MANUAL",
              lockedAt: now,
            },
            update: { owner: "MANUAL", lockedAt: now },
          })
        )
      ),
      { timeout: 60_000 }
    );
  }
  return { updated, fields };
}
