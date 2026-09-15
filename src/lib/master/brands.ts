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


// ---------------------------------------------------------------------------
// Cross-system identity, and merging duplicates
// ---------------------------------------------------------------------------

import { prisma as db } from "@/lib/db";

export interface BrandDuplicate {
  a: { id: string; name: string; colorways: number };
  b: { id: string; name: string; colorways: number };
  confidence: "certain" | "likely";
  reason: string;
}

/**
 * Brands that are probably one brand.
 *
 * Two tiers, mirroring compareSku, and for a concrete reason: `P.F. Candle` and
 * `P.F. Candles` normalise DIFFERENTLY, so an exact-match check misses the very
 * pair that motivated this. `certain` is safe to block a create on; `likely` is
 * a warning, because a hard block on similarity would be wrong more often than
 * right — Camper and Camperlab are two real brands.
 */
export async function suggestBrandDuplicates(): Promise<BrandDuplicate[]> {
  const brands = await db.brand.findMany({
    where: { mergedIntoId: null },
    select: { id: true, name: true, _count: { select: { colorways: true } } },
    orderBy: { name: "asc" },
  });
  const rows = brands.map((b) => ({
    id: b.id,
    name: b.name,
    key: normalizeBrandName(b.name),
    colorways: b._count.colorways,
  }));

  const out: BrandDuplicate[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.key === b.key) {
        out.push({
          a: { id: a.id, name: a.name, colorways: a.colorways },
          b: { id: b.id, name: b.name, colorways: b.colorways },
          confidence: "certain",
          reason: "identical once punctuation and case are removed",
        });
      } else if (nearlySame(a.key, b.key)) {
        out.push({
          a: { id: a.id, name: a.name, colorways: a.colorways },
          b: { id: b.id, name: b.name, colorways: b.colorways },
          confidence: "likely",
          reason: "one character apart — a plural, or a typo",
        });
      }
    }
  }
  return out.sort((x, y) => (x.confidence === y.confidence ? 0 : x.confidence === "certain" ? -1 : 1));
}

export interface BrandMergeResult {
  styles: number;
  colorways: number;
  refs: number;
  templateMoved: boolean;
}

/**
 * Fold one brand into another. A tombstone, never a delete.
 *
 * A brand with product behind it cannot be removed without orphaning it, and the
 * record that the two were the same thing is worth keeping — the same posture
 * merge-colorways.ts takes, which is why its 21 merges can still be explained.
 */
export async function mergeBrands(loserId: string, winnerId: string): Promise<BrandMergeResult> {
  if (loserId === winnerId) throw new BrandError("A brand cannot merge into itself.");
  const [loser, winner] = await Promise.all([
    db.brand.findUnique({ where: { id: loserId }, include: { template: true } }),
    db.brand.findUnique({ where: { id: winnerId }, include: { template: true } }),
  ]);
  if (!loser || !winner) throw new BrandError("Brand not found.");
  if (winner.mergedIntoId)
    throw new BrandError(`"${winner.name}" has itself been merged away; pick its survivor.`);

  return db.$transaction(async (tx) => {
    const styles = await tx.style.updateMany({
      where: { brandId: loserId },
      data: { brandId: winnerId },
    });
    const colorways = await tx.colorway.updateMany({
      where: { brandId: loserId },
      data: { brandId: winnerId, vendor: winner.name },
    });
    const refs = await tx.brandChannelRef.updateMany({
      where: { brandId: loserId },
      data: { brandId: winnerId },
    });

    // The survivor keeps its own template; the loser's is only adopted when the
    // survivor has none, so a merge never silently replaces settings.
    let templateMoved = false;
    if (!winner.template && loser.template) {
      await tx.brandTemplate.update({
        where: { id: loser.template.id },
        data: { brandId: winnerId },
      });
      templateMoved = true;
    } else if (loser.template) {
      await tx.brandTemplate.delete({ where: { id: loser.template.id } });
    }

    await tx.brand.update({
      where: { id: loserId },
      data: { mergedIntoId: winnerId, archived: true },
    });
    // The survivor inherits a SKU token only if it has none — never overwritten,
    // because that would rename every future style under it.
    if (!winner.skuToken && loser.skuToken)
      await tx.brand.update({ where: { id: winnerId }, data: { skuToken: loser.skuToken } });

    return { styles: styles.count, colorways: colorways.count, refs: refs.count, templateMoved };
  });
}

export interface BrandIdentityRow {
  id: string;
  name: string;
  archived: boolean;
  colorways: number;
  refs: Array<{
    id: string;
    system: string;
    externalName: string;
    externalId: string | null;
    role: string;
    productCount: number;
  }>;
}

export async function listBrandIdentity(): Promise<BrandIdentityRow[]> {
  const brands = await db.brand.findMany({
    where: { mergedIntoId: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      archived: true,
      _count: { select: { colorways: true } },
      channelRefs: {
        select: {
          id: true,
          system: true,
          externalName: true,
          externalId: true,
          role: true,
          productCount: true,
        },
      },
    },
  });
  return brands.map((b) => ({
    id: b.id,
    name: b.name,
    archived: b.archived,
    colorways: b._count.colorways,
    refs: b.channelRefs,
  }));
}

export interface UnlinkedBrandRef {
  id: string;
  system: string;
  externalName: string;
  externalId: string | null;
  role: string;
  productCount: number;
  /** Brands whose name matches — offered, never applied automatically. */
  suggestions: Array<{ id: string; name: string; confidence: "certain" | "likely" }>;
}

export async function listUnlinkedBrandRefs(): Promise<UnlinkedBrandRef[]> {
  const [refs, brands] = await Promise.all([
    db.brandChannelRef.findMany({
      where: { brandId: null, role: { not: "IGNORE" } },
      orderBy: [{ productCount: "desc" }, { externalName: "asc" }],
      take: 400,
    }),
    db.brand.findMany({
      where: { mergedIntoId: null },
      select: { id: true, name: true },
    }),
  ]);
  const keyed = brands.map((b) => ({ ...b, key: normalizeBrandName(b.name) }));

  return refs.map((r) => {
    const key = normalizeBrandName(r.externalName);
    const suggestions: UnlinkedBrandRef["suggestions"] = [];
    for (const b of keyed) {
      if (b.key === key) suggestions.push({ id: b.id, name: b.name, confidence: "certain" });
      else if (nearlySame(b.key, key))
        suggestions.push({ id: b.id, name: b.name, confidence: "likely" });
    }
    return {
      id: r.id,
      system: r.system,
      externalName: r.externalName,
      externalId: r.externalId,
      role: r.role,
      productCount: r.productCount,
      suggestions: suggestions.slice(0, 4),
    };
  });
}

export async function linkBrandRef(
  refId: string,
  input: { brandId?: string | null; role?: string }
): Promise<void> {
  const ref = await db.brandChannelRef.findUnique({ where: { id: refId } });
  if (!ref) throw new BrandError("That value is not in the review queue.");

  await db.brandChannelRef.update({
    where: { id: refId },
    data: {
      ...(input.brandId !== undefined ? { brandId: input.brandId || null } : {}),
      ...(input.role ? { role: input.role } : {}),
    },
  });

  // No outbound copy on Brand. The ref row IS the identity — it already carries
  // the channel's spelling and, where one exists, its id, keyed by
  // (brandId, system). Mirroring those onto Brand columns would be the same fact
  // in two places, which is how the master ended up with `vendor` and `brandId`
  // disagreeing in the first place.
}

/** What each channel calls this brand, resolved from its linked refs. */
export async function brandOutboundIdentity(
  brandId: string
): Promise<Record<string, { name: string; id: string | null }>> {
  const refs = await db.brandChannelRef.findMany({
    where: { brandId, role: "BRAND" },
    select: { system: true, externalName: true, externalId: true },
  });
  const out: Record<string, { name: string; id: string | null }> = {};
  for (const r of refs) out[r.system] = { name: r.externalName, id: r.externalId };
  return out;
}

/** Fill Brand.normalizedName, so the eventual unique index has something to use. */
export async function backfillNormalizedNames(): Promise<number> {
  const brands = await db.brand.findMany({ select: { id: true, name: true } });
  let n = 0;
  for (const b of brands) {
    await db.brand.update({
      where: { id: b.id },
      data: { normalizedName: normalizeBrandName(b.name) },
    });
    n++;
  }
  return n;
}

export interface ExactLinkResult {
  linked: number;
  /** Rows whose name matches nothing in Origio — the real review queue. */
  unmatched: { system: string; externalName: string; externalId: string | null; productCount: number }[];
  /** Rows whose name matches more than one brand. Never auto-linked. */
  ambiguous: { system: string; externalName: string; candidates: string[] }[];
  dryRun: boolean;
}

/**
 * Link every pulled channel value that matches exactly one Origio brand.
 *
 * The review queue was 137 rows and 108 of them were the same name spelled the
 * same way — a clerical majority that made the 29 real decisions invisible, and
 * in practice meant nobody did any of it. So the unambiguous ones are confirmed
 * in bulk and what is left is only what needs a person.
 *
 * "Exactly one" is doing the work: a name matching two brands is the
 * `P.F. Candle` / `P.F. Candles` case, which is a merge decision, not a link.
 * Those are reported and skipped. `nearlySame` suggestions are deliberately NOT
 * accepted here — a warning tier that auto-applies is not a warning.
 *
 * This writes nothing to any channel. It records which external object each
 * brand already IS, which is what stops a second one being created.
 */
export async function linkExactBrandRefs(
  opts: { dryRun?: boolean } = {}
): Promise<ExactLinkResult> {
  const [refs, brands] = await Promise.all([
    db.brandChannelRef.findMany({ where: { brandId: null, role: { not: "IGNORE" } } }),
    db.brand.findMany({ where: { mergedIntoId: null }, select: { id: true, name: true } }),
  ]);

  const byKey = new Map<string, { id: string; name: string }[]>();
  for (const b of brands) {
    const k = normalizeBrandName(b.name);
    byKey.set(k, [...(byKey.get(k) ?? []), b]);
  }

  const result: ExactLinkResult = {
    linked: 0,
    unmatched: [],
    ambiguous: [],
    dryRun: Boolean(opts.dryRun),
  };
  const toLink: { id: string; brandId: string }[] = [];

  for (const r of refs) {
    const hits = byKey.get(normalizeBrandName(r.externalName)) ?? [];
    if (hits.length === 1) toLink.push({ id: r.id, brandId: hits[0].id });
    else if (hits.length > 1)
      result.ambiguous.push({
        system: r.system,
        externalName: r.externalName,
        candidates: hits.map((h) => h.name),
      });
    else
      result.unmatched.push({
        system: r.system,
        externalName: r.externalName,
        externalId: r.externalId,
        productCount: r.productCount,
      });
  }

  if (!opts.dryRun) {
    // Grouped by brand so this is one statement per brand rather than per row —
    // db-bulk.ts documents four production incidents caused by the other shape.
    const byBrand = new Map<string, string[]>();
    for (const t of toLink) byBrand.set(t.brandId, [...(byBrand.get(t.brandId) ?? []), t.id]);
    for (const [brandId, ids] of byBrand)
      await db.brandChannelRef.updateMany({ where: { id: { in: ids } }, data: { brandId } });
  }
  result.linked = toLink.length;
  return result;
}
