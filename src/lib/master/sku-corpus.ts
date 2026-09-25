// Loading only the SKUs a candidate could possibly collide with.
//
// Both duplicate checks — the validate route behind the builder's SKU field, and
// assertSkusAreNew in create.ts — did
//
//   prisma.colorway.findMany({ select: { colorwaySku: true } })
//
// the whole table, on every call. create.ts even carries a comment claiming "the
// candidate set is small — no need to load the whole catalogue", directly above
// the code that loads the whole catalogue. At 4,584 colorways that is tolerable
// once on submit and wrong behind a typeahead.
//
// Narrowing has to preserve every match compareSku can make, which is the part
// worth getting right rather than guessing at. Its three "certain" tiers all
// require core() equality — the modifiers, prefix and body tokens concatenated
// down to letters and digits. So a colliding SKU must contain the same letters
// in the same order, which means every body token of the candidate appears as a
// SUBSTRING of the other SKU, whether or not the hyphens fall in the same place:
//
//   EXT-PB-BARTH-AM-10   vs  EEXT-PB-BRTH-AM-10     (prefix typo)
//   LIV-KRI-DWN-3034     vs  LIV-KR-JPN-DWN-3034    (a rename)
//
// A substring filter on the longest body token is therefore a superset of the
// real candidates, and it is one indexable-ish query instead of the whole table.

import { prisma } from "@/lib/db";
import { parseSku, normalizeSku } from "./sku";

export interface CorpusOptions {
  /** Also consider style SKUs. The manual path wrote styleSku === colorwaySku,
   *  so a new style stem can legitimately clash with an old colorway's. */
  includeStyles?: boolean;
  /** Safety valve: if the filter somehow matches everything, stop here. */
  limit?: number;
}

/**
 * The SKUs worth comparing `candidate` against.
 *
 * Falls back to the full list only when the candidate has no usable token —
 * which means it is malformed, and validateSku is about to say so anyway.
 */
export async function loadSkuCorpus(
  candidate: string,
  opts: CorpusOptions = {}
): Promise<string[]> {
  const limit = opts.limit ?? 5000;
  const parts = parseSku(candidate);
  // The longest token is the most selective, and a short one ("W", "OS") would
  // match half the catalogue.
  const token = [...parts.body].sort((a, b) => b.length - a.length)[0];

  const where =
    token && token.length >= 3
      ? { colorwaySku: { contains: token, mode: "insensitive" as const } }
      : {};

  const colorways = await prisma.colorway.findMany({
    where,
    select: { colorwaySku: true },
    take: limit,
  });
  const out = colorways.map((c) => c.colorwaySku);

  if (opts.includeStyles) {
    const styles = await prisma.style.findMany({
      where: token && token.length >= 3
        ? { styleSku: { contains: token, mode: "insensitive" as const } }
        : {},
      select: { styleSku: true },
      take: limit,
    });
    out.push(...styles.map((s) => s.styleSku));
  }

  return [...new Set(out)];
}

/**
 * Exact-match check, in SQL.
 *
 * The overwhelming majority of real collisions are the same string twice, and
 * that question does not need a corpus in memory at all. Case-insensitive
 * because normalizeSku uppercases before comparing, which is how
 * `LIV-Needle-W` and `LIV-NEEDLE-W` looked identical to us and different to Pio.
 */
export async function findExactSkuHolders(
  skus: string[]
): Promise<Map<string, { level: "style" | "colorway" | "variant"; sku: string }>> {
  const normalized = [...new Set(skus.map(normalizeSku))].filter(Boolean);
  if (!normalized.length) return new Map();

  const [styles, colorways, variants] = await Promise.all([
    prisma.style.findMany({
      where: { styleSku: { in: normalized, mode: "insensitive" } },
      select: { styleSku: true },
    }),
    prisma.colorway.findMany({
      where: { colorwaySku: { in: normalized, mode: "insensitive" } },
      select: { colorwaySku: true },
    }),
    prisma.variant.findMany({
      where: { variantSku: { in: normalized, mode: "insensitive" } },
      select: { variantSku: true },
    }),
  ]);

  const out = new Map<string, { level: "style" | "colorway" | "variant"; sku: string }>();
  for (const v of variants) out.set(normalizeSku(v.variantSku), { level: "variant", sku: v.variantSku });
  for (const c of colorways) out.set(normalizeSku(c.colorwaySku), { level: "colorway", sku: c.colorwaySku });
  for (const s of styles) out.set(normalizeSku(s.styleSku), { level: "style", sku: s.styleSku });
  return out;
}
