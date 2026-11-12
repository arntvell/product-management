// The decisions behind POST /api/partner/v1/brands, with no database: which
// existing brand a Loom brand is, and which SKU token a new one gets. Kept pure
// so they are tested without touching the one database there is (production).
import { MEANINGFUL_PREFIXES } from "@/lib/master/sku";
import { derivedBrandToken, nearlySame, normalizeBrandName } from "@/lib/master/brands";

export interface BrandRow {
  id: string;
  name: string;
  isLivid: boolean;
  skuToken: string | null;
  loomBrandId: string | null;
  archived: boolean;
  mergedIntoId: string | null;
}

export type BrandMatch =
  | { kind: "found"; brand: BrandRow; by: "loom_brand_id" | "name" }
  | { kind: "none" }
  | { kind: "refuse"; error: string };

/** Follow a merge to the brand that holds the products now. */
function winner(b: BrandRow, byId: Map<string, BrandRow>): BrandRow {
  let cur = b;
  for (let i = 0; i < 10 && cur.mergedIntoId; i++) {
    const next = byId.get(cur.mergedIntoId);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/**
 * Loom's id first, then the name with case, punctuation and spacing ignored.
 *
 * `normalizedName` is nullable in the table, so the key is computed here over
 * every row rather than read. A name that matches nothing exactly but is one
 * letter from a brand (a plural, a typo) is refused, not created: a second
 * spelling of a brand is the duplicate the brand screens exist to clean up.
 */
export function matchBrand(
  input: { loom_brand_id?: string | null; name: string },
  all: BrandRow[]
): BrandMatch {
  const byId = new Map(all.map((b) => [b.id, b]));
  const loomId = input.loom_brand_id?.trim() || null;

  if (loomId) {
    const hit = all.find((b) => b.loomBrandId === loomId);
    if (hit) return { kind: "found", brand: winner(hit, byId), by: "loom_brand_id" };
  }

  const key = normalizeBrandName(input.name);
  if (!key) return { kind: "refuse", error: "name is missing" };

  const exact = all.filter((b) => normalizeBrandName(b.name) === key);
  const winners = [...new Map(exact.map((b) => [winner(b, byId).id, winner(b, byId)])).values()];
  if (winners.length > 1)
    return {
      kind: "refuse",
      error: `"${input.name}" matches more than one Origio brand (${winners.map((w) => w.name).join(", ")}); ask Origio to merge them`,
    };
  if (winners.length === 1) {
    const brand = winners[0];
    if (loomId && brand.loomBrandId && brand.loomBrandId !== loomId)
      return {
        kind: "refuse",
        error: `Origio's ${brand.name} is already linked to Loom brand ${brand.loomBrandId}, not ${loomId}`,
      };
    return { kind: "found", brand, by: "name" };
  }

  const similar = all
    .filter((b) => !b.mergedIntoId && nearlySame(key, normalizeBrandName(b.name)))
    .map((b) => b.name);
  if (similar.length)
    return {
      kind: "refuse",
      error: `"${input.name}" is not in Origio, but ${similar.map((s) => `"${s}"`).join(", ")} is close; use that name, or ask Origio`,
    };
  return { kind: "none" };
}

/** The token a brand's new SKUs are built with: its own, else the derived one. */
export function effectiveToken(b: { name: string; skuToken: string | null }): string | null {
  return b.skuToken ?? derivedBrandToken(b.name);
}

export type TokenChoice =
  | { ok: true; token: string; source: "given" | "derived" }
  | { ok: false; error: string };

/**
 * The token for a NEW brand.
 *
 * A token is taken when another brand stores it, derives it (no token of its
 * own), or already has style SKUs under `EXT-<token>-`. A given token that is
 * taken is refused. A derived one that is taken is refused too, asking for
 * `sku_token`, rather than guessed at: a style SKU is never rewritten, so a
 * wrong token diverges the brand for good.
 */
export function chooseToken(
  name: string,
  given: string | null,
  taken: Map<string, string>
): TokenChoice {
  const token = given ?? derivedBrandToken(name);
  if (!token) return { ok: false, error: `no SKU token can be derived from "${name}"; send sku_token` };
  if ((MEANINGFUL_PREFIXES as readonly string[]).includes(token) || token === "EXT" || token === "LIV")
    return { ok: false, error: `${token} is a reserved SKU prefix; send another sku_token` };
  const owner = taken.get(token);
  if (owner)
    return {
      ok: false,
      error: given
        ? `SKU token ${token} is already used by ${owner}; send another sku_token`
        : `the derived SKU token ${token} is already used by ${owner}; send sku_token`,
    };
  return { ok: true, token, source: given ? "given" : "derived" };
}

/** Every token in use, and by which brand: stored, derived, or seen in style SKUs. */
export function takenTokens(
  brands: BrandRow[],
  styleSkus: { styleSku: string; brandName: string | null }[]
): Map<string, string> {
  const taken = new Map<string, string>();
  for (const b of brands) {
    if (b.mergedIntoId) continue;
    const t = effectiveToken(b);
    if (t && !taken.has(t)) taken.set(t, b.name);
  }
  for (const s of styleSkus) {
    const m = /^EXT-([A-Z0-9]+)-/.exec(s.styleSku);
    if (m && !taken.has(m[1])) taken.set(m[1], s.brandName ?? `style ${s.styleSku}`);
  }
  return taken;
}
