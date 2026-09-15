// Brand settings: the defaults a new product inherits, and the SKU token a
// brand is written with.
//
// Most of this is UI over `BrandTemplate`, which already modelled the customs
// block, the default channels, the manufacturer and a category. Two fields are
// new and both are load-bearing:
//
//   Brand.skuToken               what the brand is CALLED in a SKU. 40 of 51
//                                external brands write something the
//                                abbreviation rule would not produce, so
//                                without this the builder renames them.
//   BrandTemplate.defaultSizeSystemId  which size run the builder opens with.

import { prisma } from "@/lib/db";
import { buildStyleSku, skuTokens, MEANINGFUL_PREFIXES } from "./sku";

export class BrandError extends Error {}

export interface BrandListItem {
  id: string;
  name: string;
  isLivid: boolean;
  skuToken: string | null;
  /** What the abbreviation rule alone would produce — shown next to the token. */
  derivedToken: string | null;
  hasTemplate: boolean;
  defaultSizeSystem: { id: string; name: string } | null;
  styles: number;
  colorways: number;
  /**
   * Set when this brand's name normalises to the same thing as another's, or is
   * one character away. `P.F. Candle` and `P.F. Candles` are both live, 27 and
   * 32 colorways, both writing PF.
   */
  possibleDuplicateOf: string[];
}

/**
 * Compare-key for a brand name: case, punctuation and spacing removed, "&"
 * spelled out. Exact collisions on this are certainly one brand; near misses
 * are reported separately, because a plural is a likely duplicate and not a
 * provable one.
 */
export function normalizeBrandName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/** Singular/plural or one-character apart. A warning, never a block. */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  if (long.length === short.length) {
    let diff = 0;
    for (let i = 0; i < long.length; i++) if (long[i] !== short[i]) diff++;
    return diff === 1;
  }
  // One insertion.
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

export async function listBrandsWithSettings(): Promise<BrandListItem[]> {
  const brands = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      isLivid: true,
      skuToken: true,
      _count: { select: { styles: true, colorways: true } },
      template: {
        select: { id: true, defaultSizeSystem: { select: { id: true, name: true } } },
      },
    },
  });

  const byKey = new Map<string, string[]>();
  for (const b of brands) {
    const k = normalizeBrandName(b.name);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(b.name);
  }

  return brands.map((b) => {
    const key = normalizeBrandName(b.name);
    const dupes = new Set<string>();
    for (const [otherKey, names] of byKey) {
      if (!nearlySame(key, otherKey)) continue;
      for (const n of names) if (n !== b.name) dupes.add(n);
    }
    return {
      id: b.id,
      name: b.name,
      isLivid: b.isLivid,
      skuToken: b.skuToken,
      derivedToken: b.isLivid ? null : derivedBrandToken(b.name),
      hasTemplate: b.template !== null,
      defaultSizeSystem: b.template?.defaultSizeSystem ?? null,
      styles: b._count.styles,
      colorways: b._count.colorways,
      possibleDuplicateOf: [...dupes].sort(),
    };
  });
}

/** What buildStyleSku would use for this brand with no token set. */
export function derivedBrandToken(brandName: string): string | null {
  const sku = buildStyleSku({ prefix: "EXT", brandName, style: "X" });
  const t = skuTokens(sku);
  let i = 0;
  while (i < t.length && (MEANINGFUL_PREFIXES as readonly string[]).includes(t[i])) i++;
  return t[i + 1] ?? null;
}

export interface BrandSettings {
  id: string;
  name: string;
  isLivid: boolean;
  skuToken: string | null;
  derivedToken: string | null;
  /** Live example of what a new style would be called under these settings. */
  exampleStyleSku: string;
  template: {
    category: string;
    gender: string;
    unisex: boolean;
    channels: string[];
    hsCode: string;
    customsDescription: string;
    weightKg: string;
    fiberComposition: string;
    countryOfOrigin: string;
    manufacturerId: string;
    defaultSizeSystemId: string;
  };
}

export async function getBrandSettings(id: string): Promise<BrandSettings | null> {
  const b = await prisma.brand.findUnique({
    where: { id },
    select: { id: true, name: true, isLivid: true, skuToken: true, template: true },
  });
  if (!b) return null;
  const t = b.template;
  return {
    id: b.id,
    name: b.name,
    isLivid: b.isLivid,
    skuToken: b.skuToken,
    derivedToken: b.isLivid ? null : derivedBrandToken(b.name),
    exampleStyleSku: exampleStyleSku(b.name, b.skuToken, b.isLivid),
    template: {
      category: t?.category ?? "",
      gender: t?.gender ?? "",
      unisex: t?.unisex ?? false,
      channels: (t?.channels as string[]) ?? [],
      hsCode: t?.hsCode ?? "",
      customsDescription: t?.customsDescription ?? "",
      weightKg: t?.weightKg?.toString() ?? "",
      fiberComposition: t?.fiberComposition ?? "",
      countryOfOrigin: t?.countryOfOrigin ?? "",
      manufacturerId: t?.manufacturerId ?? "",
      defaultSizeSystemId: t?.defaultSizeSystemId ?? "",
    },
  };
}

export function exampleStyleSku(
  brandName: string,
  skuToken: string | null,
  isLivid: boolean
): string {
  return buildStyleSku({
    prefix: isLivid ? "LIV" : "EXT",
    brandToken: skuToken,
    brandName,
    style: "Example Style",
  });
}

export interface SaveBrandSettingsInput {
  skuToken?: string | null;
  template?: Partial<BrandSettings["template"]>;
}

export async function saveBrandSettings(
  id: string,
  input: SaveBrandSettingsInput
): Promise<void> {
  const brand = await prisma.brand.findUnique({ where: { id }, select: { id: true } });
  if (!brand) throw new BrandError("Brand not found.");

  if (input.skuToken !== undefined) {
    const raw = input.skuToken?.trim().toUpperCase() || null;
    if (raw && !/^[A-Z0-9]{1,8}$/.test(raw))
      throw new BrandError("A SKU token is 1–8 letters or digits, no spaces or hyphens.");
    await prisma.brand.update({ where: { id }, data: { skuToken: raw } });
  }

  if (!input.template) return;
  const t = input.template;
  const data = {
    ...(t.category !== undefined ? { category: blank(t.category) } : {}),
    ...(t.gender !== undefined ? { gender: blank(t.gender) } : {}),
    ...(t.unisex !== undefined ? { unisex: t.unisex } : {}),
    ...(t.channels !== undefined
      ? { channels: t.channels as ("SHOPIFY" | "LOOM" | "SITOO")[] }
      : {}),
    ...(t.hsCode !== undefined ? { hsCode: blank(t.hsCode) } : {}),
    ...(t.customsDescription !== undefined
      ? { customsDescription: blank(t.customsDescription) }
      : {}),
    ...(t.weightKg !== undefined ? { weightKg: decimalOrNull(t.weightKg) } : {}),
    ...(t.fiberComposition !== undefined
      ? { fiberComposition: blank(t.fiberComposition) }
      : {}),
    ...(t.countryOfOrigin !== undefined
      ? { countryOfOrigin: blank(t.countryOfOrigin) }
      : {}),
    ...(t.manufacturerId !== undefined ? { manufacturerId: blank(t.manufacturerId) } : {}),
    ...(t.defaultSizeSystemId !== undefined
      ? { defaultSizeSystemId: blank(t.defaultSizeSystemId) }
      : {}),
  };

  await prisma.brandTemplate.upsert({
    where: { brandId: id },
    create: { brandId: id, ...data },
    update: data,
  });
}

function blank(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function decimalOrNull(v: string | null | undefined): string | null {
  const t = v?.trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t))
    throw new BrandError(`Weight "${v}" is not a number of kilograms.`);
  return t;
}

/**
 * Check a proposed brand name against the ones that exist.
 *
 * An exact normalised collision is a duplicate and blocks; a near miss warns.
 * `P.F. Candle` / `P.F. Candles` normalise DIFFERENTLY — they are a near miss,
 * not an exact one — which is why both tiers exist and why the looser one
 * cannot be a block.
 */
export async function checkBrandName(
  name: string
): Promise<{ ok: boolean; exact: string[]; similar: string[] }> {
  const key = normalizeBrandName(name);
  if (!key) return { ok: false, exact: [], similar: [] };
  const brands = await prisma.brand.findMany({ select: { name: true } });
  const exact: string[] = [];
  const similar: string[] = [];
  for (const b of brands) {
    const other = normalizeBrandName(b.name);
    if (other === key) exact.push(b.name);
    else if (nearlySame(key, other)) similar.push(b.name);
  }
  return { ok: exact.length === 0, exact, similar };
}

/** Sizes for a brand: the new size system if set, else the deprecated string list. */
export async function resolveBrandSizes(
  brandId: string
): Promise<{ source: "system" | "legacy" | "none"; labels: string[]; systemId: string | null }> {
  const t = await prisma.brandTemplate.findUnique({
    where: { brandId },
    select: {
      sizes: true,
      defaultSizeSystemId: true,
      defaultSizeSystem: {
        select: {
          id: true,
          entries: {
            where: { archived: false },
            orderBy: { position: "asc" },
            select: { sizeLabel: true },
          },
        },
      },
    },
  });
  if (t?.defaultSizeSystem)
    return {
      source: "system",
      labels: t.defaultSizeSystem.entries.map((e) => e.sizeLabel),
      systemId: t.defaultSizeSystem.id,
    };
  if (t?.sizes.length) return { source: "legacy", labels: t.sizes, systemId: null };
  return { source: "none", labels: [], systemId: null };
}

