// The "fix list": products that cannot be pushed to a channel yet, together
// with the fields blocking them and the current value of every field that can
// be corrected by hand. Feeds /catalog/fix.
import { prisma } from "@/lib/db";
import { loomMissing } from "./readiness";
import { auditCustoms } from "./customs-audit";

export const EDITABLE_FIELDS = [
  "manufacturerId",
  "fiberComposition",
  "customsDescription",
  "hsCode",
  "weightKg",
  "countryOfOrigin",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface FixRow {
  id: string;
  colorwaySku: string;
  name: string;
  styleName: string;
  vendor: string | null;
  productType: string | null;
  isCore: boolean;
  origin: "NEW" | "CARRYOVER" | null;
  source: string;
  variantCount: number;
  /** Loom blockers, e.g. ["manufacturer", "fibre"]. */
  missing: string[];
  /** Blockers no amount of editing here can fix (variants, price). */
  unfixableHere: string[];
  /** Contradictions in the customs data — wrong, not missing. */
  warnings: string[];
  values: {
    manufacturerId: string | null;
    /** Resolved value + whether it comes from the style or a colorway override. */
    fiberComposition: { value: string | null; fromStyle: boolean };
    customsDescription: { value: string | null; fromStyle: boolean };
    hsCode: { value: string | null; fromStyle: boolean };
    weightKg: { value: string | null; fromStyle: boolean };
    countryOfOrigin: string | null;
  };
  lockedFields: string[];
}

export interface FixListOptions {
  seasonCode: string;
  includeCore?: boolean;
  vendors?: string[];
  /** Include products that already pass the gate (to fix wrong-but-present data). */
  includeReady?: boolean;
}

function txt(v: string | null | undefined): string | null {
  return v && v.trim() ? v : null;
}

export async function getFixList(opts: FixListOptions): Promise<{
  rows: FixRow[];
  manufacturers: { id: string; name: string; country: string | null }[];
  counts: { total: number; blocked: number; withWarnings: number; unfixable: number };
}> {
  const season = await prisma.season.findUnique({
    where: { code: opts.seasonCode },
    select: { id: true },
  });
  if (!season) throw new Error(`Unknown season ${opts.seasonCode}`);

  const inSeason = { entries: { some: { seasonId: season.id } } };
  const where: Record<string, unknown> = {
    OR: opts.includeCore ? [inSeason, { isCore: true }] : [inSeason],
  };
  if (opts.vendors?.length) where.vendor = { in: opts.vendors };

  const colorways = await prisma.colorway.findMany({
    where,
    include: {
      style: true,
      variants: { select: { id: true } },
      prices: { where: { seasonId: season.id }, select: { priceType: true } },
      entries: { where: { seasonId: season.id }, select: { origin: true } },
    },
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
  });

  const ids = colorways.map((c) => c.id);
  const styleIds = [...new Set(colorways.map((c) => c.styleId))];
  const locks = await prisma.fieldOwner.findMany({
    where: {
      owner: "MANUAL",
      OR: [
        { entityType: "colorway", entityId: { in: ids } },
        { entityType: "style", entityId: { in: styleIds } },
      ],
    },
    select: { entityType: true, entityId: true, field: true },
  });
  const lockKey = new Set(locks.map((l) => `${l.entityType}|${l.entityId}|${l.field}`));

  const manufacturers = await prisma.manufacturer.findMany({
    select: { id: true, name: true, country: true },
    orderBy: { name: "asc" },
  });

  const rows: FixRow[] = [];
  for (const c of colorways) {
    const fibre = txt(c.fiberCompositionOverride) ?? c.style.fiberComposition;
    const customs = txt(c.customsDescriptionOverride) ?? c.style.customsDescription;
    const hs = txt(c.hsCodeOverride) ?? c.style.hsCode;
    const weight = c.weightKgOverride ?? c.style.weightKg;

    const missing = loomMissing({
      hasVariants: c.variants.length > 0,
      hasPrice: c.prices.some((p) => p.priceType === "MSRP"),
      hsCode: hs,
      customsDescription: customs,
      weightKg: weight,
      fiberComposition: fibre,
      countryOfOrigin: c.countryOfOrigin,
      hasManufacturer: !!c.manufacturerId,
    });
    const warnings = auditCustoms({
      vendor: c.vendor,
      productType: c.productType,
      displayName: `${c.style.styleName} ${c.name}`,
      customsDescription: customs,
      fiberComposition: fibre,
    });
    if (!opts.includeReady && !missing.length && !warnings.length) continue;

    const locked: string[] = [];
    for (const f of EDITABLE_FIELDS) {
      if (
        lockKey.has(`colorway|${c.id}|${f}`) ||
        lockKey.has(`style|${c.styleId}|${f}`)
      )
        locked.push(f);
    }

    rows.push({
      id: c.id,
      colorwaySku: c.colorwaySku,
      name: c.name,
      styleName: c.style.styleName,
      vendor: c.vendor,
      productType: c.productType,
      isCore: c.isCore,
      origin: c.entries[0]?.origin ?? null,
      source: c.source,
      variantCount: c.variants.length,
      missing,
      // Sizes and prices are not free text — they come from a sync or the
      // price carry-forward, so this editor cannot resolve them.
      unfixableHere: missing.filter((m) => m === "variants" || m === "price"),
      warnings,
      values: {
        manufacturerId: c.manufacturerId,
        fiberComposition: { value: fibre, fromStyle: !txt(c.fiberCompositionOverride) },
        customsDescription: { value: customs, fromStyle: !txt(c.customsDescriptionOverride) },
        hsCode: { value: hs, fromStyle: !txt(c.hsCodeOverride) },
        weightKg: { value: weight?.toString() ?? null, fromStyle: c.weightKgOverride == null },
        countryOfOrigin: c.countryOfOrigin,
      },
      lockedFields: locked,
    });
  }

  return {
    rows,
    manufacturers,
    counts: {
      total: colorways.length,
      blocked: rows.filter((r) => r.missing.length).length,
      withWarnings: rows.filter((r) => r.warnings.length).length,
      unfixable: rows.filter((r) => r.unfixableHere.length).length,
    },
  };
}
