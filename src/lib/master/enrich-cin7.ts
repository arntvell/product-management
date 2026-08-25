// Enrich the master's customs block from Cin7 Core.
//
// Cin7 keeps the customs data in its generic "additional attribute" slots
// rather than named fields, which is why the original import never picked it
// up:
//   AdditionalAttribute1 -> country-of-origin code   ("CN")
//   AdditionalAttribute2 -> HS code                  ("61101130")
//   AdditionalAttribute3 -> customs description with the fibre embedded
//                           ("Men's Sweater - Knitted 100% wool")
//   Weight / WeightUnits -> shipping weight
//
// Non-destructive, like every other pass: fills only fields that are currently
// empty, never overwrites, and skips anything locked to MANUAL ownership.
import { prisma } from "@/lib/db";
import { fetchAllProducts } from "@/lib/cin7/client";
import type { Cin7Product } from "@/lib/cin7/types";

export interface Cin7EnrichOptions {
  /** Limit to one season's products (by code). Omit for the whole catalogue. */
  seasonCode?: string;
  /** Also include CORE products, whatever season they sit in. */
  includeCore?: boolean;
  /** Limit to these vendors (exact match). Omit for all. */
  vendors?: string[];
  /** Restrict to these fields. Omit for all of them. */
  fields?: Cin7Field[];
}

export type Cin7Field =
  | "hsCode"
  | "customsDescription"
  | "weightKg"
  | "fiberComposition"
  | "countryOfOrigin";

const ALL_FIELDS: Cin7Field[] = [
  "hsCode",
  "customsDescription",
  "weightKg",
  "fiberComposition",
  "countryOfOrigin",
];

// Style-level fields fall back colorway -> style in the Loom payload, so the
// customs block is written on the Style; country of origin lives on Colorway.
const STYLE_FIELDS = new Set<Cin7Field>([
  "hsCode",
  "customsDescription",
  "weightKg",
  "fiberComposition",
]);

function has(v: string | null | undefined): string | null {
  return v && String(v).trim() ? String(v).trim() : null;
}

/**
 * Some Cin7 rows carry junk in the attribute slots (a bare "500"). A customs
 * description has to be words, so reject anything without letters.
 */
function asDescription(v: string | null | undefined): string | null {
  const s = has(v);
  return s && /\p{L}/u.test(s) ? s : null;
}

function weightToKg(weight: number | null, units: string | null): number | null {
  if (weight == null || weight <= 0) return null;
  const u = (units ?? "").toLowerCase();
  if (u === "g" || u === "gram" || u === "grams") return weight / 1000;
  return weight;
}

/**
 * Pull the fibre composition out of a Cin7 customs description.
 * "Men's Sweater - Knitted 100% wool" -> "100% wool"
 * "Men's Shirt - 60% cotton 40% linen" -> "60% cotton 40% linen"
 * Returns null when no percentage clause is present, rather than guessing —
 * the raw string is a customs description, not a composition, and Cin7's own
 * data contains typos ("wiil"), so a bad parse is worse than no value.
 */
export function parseFiberComposition(desc: string | null | undefined): string | null {
  const s = has(desc);
  if (!s) return null;
  const matches = s.match(/\d{1,3}\s*%\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-\s]*/g);
  if (!matches?.length) return null;
  const cleaned = matches
    .map((m) => m.replace(/\s+/g, " ").trim().replace(/[,;.]$/, ""))
    .filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : null;
}

/**
 * Learn country-code -> country-name from Cin7's own rows, so the master stores
 * the same full names Threadflow supplies ("Portugal") rather than raw codes.
 * Cin7 uses two different code systems: CountryOfOriginCode is ISO alpha-3
 * ("PRT") while AdditionalAttribute1 is alpha-2 ("PT"), so learn from both.
 */
function buildCountryMap(products: Cin7Product[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of products) {
    const raw = p as unknown as Record<string, string>;
    const name = has(p.CountryOfOrigin);
    if (!name) continue;
    for (const code of [has(raw.CountryOfOriginCode), has(raw.AdditionalAttribute1)]) {
      if (code && !map.has(code.toUpperCase())) map.set(code.toUpperCase(), name);
    }
  }
  return map;
}

export interface Cin7FieldChange {
  entity: "style" | "colorway";
  entityId: string;
  field: Cin7Field;
  value: string;
}

export interface Cin7Change {
  colorwayId: string;
  colorwaySku: string;
  name: string;
  matchedSku: string;
  changes: Cin7FieldChange[];
}

export interface Cin7EnrichPreview {
  candidates: number; // CIN7_IMPORT colorways considered
  matched: number; // found in the Cin7 catalogue
  unmatched: number;
  wouldChange: number; // colorways gaining at least one field
  byField: Record<string, number>;
  skippedLocked: number;
  unparseableFibre: number; // had a customs desc but no percentage clause
  sample: Cin7Change[];
}

async function collectChanges(opts: Cin7EnrichOptions): Promise<{
  preview: Cin7EnrichPreview;
  changes: Cin7Change[];
}> {
  const fields = opts.fields?.length ? opts.fields : ALL_FIELDS;
  const fieldSet = new Set(fields);

  const products = await fetchAllProducts();
  const bySku = new Map<string, Cin7Product>();
  for (const p of products) if (p.SKU) bySku.set(p.SKU.toUpperCase(), p);
  const countryByCode = buildCountryMap(products);

  const where: Record<string, unknown> = { source: "CIN7_IMPORT" };
  if (opts.seasonCode) {
    const inSeason = { entries: { some: { season: { code: opts.seasonCode } } } };
    // "the season, plus CORE wherever it lives" is the usual publishing scope.
    where.OR = opts.includeCore ? [inSeason, { isCore: true }] : [inSeason];
  } else if (opts.includeCore) {
    where.isCore = true;
  }
  if (opts.vendors?.length) where.vendor = { in: opts.vendors };
  const colorways = await prisma.colorway.findMany({
    where,
    include: { style: true, variants: { select: { variantSku: true } } },
  });

  // MANUAL locks, on either entity, must never be overwritten.
  const lockRows = await prisma.fieldOwner.findMany({
    where: { owner: "MANUAL", entityType: { in: ["style", "colorway"] } },
    select: { entityType: true, entityId: true, field: true },
  });
  const locked = new Set(lockRows.map((l) => `${l.entityType}|${l.entityId}|${l.field}`));

  const byField: Record<string, number> = {};
  const changes: Cin7Change[] = [];
  let matched = 0;
  let skippedLocked = 0;
  let unparseableFibre = 0;

  for (const cw of colorways) {
    let p: Cin7Product | undefined;
    for (const v of cw.variants) {
      p = bySku.get(String(v.variantSku).toUpperCase());
      if (p) break;
    }
    if (!p) continue;
    matched++;

    const a = p as unknown as Record<string, string | number | null>;
    const attr1 = has(a.AdditionalAttribute1 as string);
    const attr2 = has(a.AdditionalAttribute2 as string);
    const attr3 = asDescription(a.AdditionalAttribute3 as string);

    // Candidate values, only where Cin7 actually has something.
    const hsCode = has(p.HSCode) ?? (attr2 && /^\d{6,10}$/.test(attr2) ? attr2 : null);
    const customsDescription = attr3 ?? asDescription(p.Description);
    const kg = weightToKg(p.Weight, p.WeightUnits);
    const fiberComposition = parseFiberComposition(attr3);
    const countryOfOrigin =
      has(p.CountryOfOrigin) ??
      (attr1 ? countryByCode.get(attr1.toUpperCase()) ?? attr1 : null);

    if (fieldSet.has("fiberComposition") && customsDescription && !fiberComposition) {
      unparseableFibre++;
    }

    const proposed: { field: Cin7Field; value: string | null; current: unknown }[] = [
      { field: "hsCode", value: hsCode, current: has(cw.hsCodeOverride) ?? cw.style.hsCode },
      {
        field: "customsDescription",
        value: customsDescription,
        current: has(cw.customsDescriptionOverride) ?? cw.style.customsDescription,
      },
      {
        field: "weightKg",
        value: kg == null ? null : String(kg),
        current: cw.weightKgOverride ?? cw.style.weightKg,
      },
      {
        field: "fiberComposition",
        value: fiberComposition,
        current: has(cw.fiberCompositionOverride) ?? cw.style.fiberComposition,
      },
      { field: "countryOfOrigin", value: countryOfOrigin, current: cw.countryOfOrigin },
    ];

    const rowChanges: Cin7FieldChange[] = [];
    for (const { field, value, current } of proposed) {
      if (!fieldSet.has(field)) continue;
      if (value == null) continue;
      // Fill only what is empty — never overwrite an existing value.
      const isEmpty =
        field === "weightKg" ? current == null : !has(current as string | null);
      if (!isEmpty) continue;
      const entity = STYLE_FIELDS.has(field) ? "style" : "colorway";
      const entityId = entity === "style" ? cw.styleId : cw.id;
      if (locked.has(`${entity}|${entityId}|${field}`)) {
        skippedLocked++;
        continue;
      }
      rowChanges.push({ entity, entityId, field, value });
      byField[field] = (byField[field] ?? 0) + 1;
    }

    if (rowChanges.length) {
      changes.push({
        colorwayId: cw.id,
        colorwaySku: cw.colorwaySku,
        name: cw.name,
        matchedSku: p.SKU,
        changes: rowChanges,
      });
    }
  }

  return {
    preview: {
      candidates: colorways.length,
      matched,
      unmatched: colorways.length - matched,
      wouldChange: changes.length,
      byField,
      skippedLocked,
      unparseableFibre,
      sample: changes.slice(0, 25),
    },
    changes,
  };
}

export async function previewCin7Enrichment(
  opts: Cin7EnrichOptions = {}
): Promise<Cin7EnrichPreview> {
  const { preview } = await collectChanges(opts);
  return preview;
}

export interface Cin7EnrichResult extends Cin7EnrichPreview {
  stylesUpdated: number;
  colorwaysUpdated: number;
}

export async function runCin7Enrichment(
  opts: Cin7EnrichOptions = {}
): Promise<Cin7EnrichResult> {
  const { preview, changes } = await collectChanges(opts);

  // Group per entity so each style/colorway is written once.
  const styleData = new Map<string, Record<string, unknown>>();
  const colorwayData = new Map<string, Record<string, unknown>>();
  for (const c of changes) {
    for (const ch of c.changes) {
      const bucket = ch.entity === "style" ? styleData : colorwayData;
      const data = bucket.get(ch.entityId) ?? {};
      data[ch.field] = ch.field === "weightKg" ? Number(ch.value) : ch.value;
      bucket.set(ch.entityId, data);
    }
  }

  // Chunked so a large catalogue cannot overrun the transaction timeout.
  const CHUNK = 50;
  const styleEntries = [...styleData];
  for (let i = 0; i < styleEntries.length; i += CHUNK) {
    await prisma.$transaction(
      styleEntries
        .slice(i, i + CHUNK)
        .map(([id, data]) => prisma.style.update({ where: { id }, data })),
      { timeout: 60_000 }
    );
  }
  const colorwayEntries = [...colorwayData];
  for (let i = 0; i < colorwayEntries.length; i += CHUNK) {
    await prisma.$transaction(
      colorwayEntries
        .slice(i, i + CHUNK)
        .map(([id, data]) => prisma.colorway.update({ where: { id }, data })),
      { timeout: 60_000 }
    );
  }

  return {
    ...preview,
    stylesUpdated: styleData.size,
    colorwaysUpdated: colorwayData.size,
  };
}
