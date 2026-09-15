// SKU identity: canonical form, and detection of the same garment entered twice
// under two spellings.
//
// `Variant.variantSku` and `Colorway.colorwaySku` are already @unique, and that
// did not help: the duplicates in production are not the same string twice, they
// are two *different* strings for one garment —
//
//   LIV-KRI-DWN-3034      vs  LIV-KR-JPN-DWN-3034     (a rename that reached one system)
//   EEXT-PB-BRTH-AM-10    vs  EXT-PB-BARTH-Homme-10   (a typo plus an abbreviation)
//
// No unique index catches those. Only detection at the moment of creation does,
// which is why this runs in create.ts rather than in a cleanup script.
//
// Convention, derived from the 9,822-row CFO ledger rather than invented:
//
//   [IMP-] PREFIX - <style tokens…> - <colour tokens…> - SIZE
//
//   prefixes   LIV (8,062) · IMP-LIV (1,491) · EXT · VN-ONLN · OLD · B2B
//   segments   2–9, most commonly 4–6
//   size       trailing S/M/L/XL/2XL/XS, or a 4-digit waist+length (3134),
//              sometimes slashed (28/34) — 123 rows use the slash form

/**
 * Modifier prefixes that make two otherwise-identical SKUs *different products*.
 *
 * This is the distinction that matters most here. An imperfect is a production
 * error sold at a discount and it must stay separate from the garment it came
 * from — so IMP-LIV-FLY-… and LIV-FLY-… are near-identical strings that are
 * emphatically not duplicates. Treating them as such was a real error made
 * during the 2026-09-11 reconciliation; it would have destroyed the distinction.
 */
export const MEANINGFUL_PREFIXES = ["IMP", "OLD", "B2B", "SMPLS", "SVD"] as const;

/** Misspellings of a real prefix — these *are* noise. */
const PREFIX_TYPOS: Record<string, string> = { EEXT: "EXT", EXTT: "EXT", LIVV: "LIV" };

const SIZE_WORDS = new Set([
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "OS", "ONESIZE",
]);

/**
 * The form the master stores and compares. Case and separators vary in the
 * existing corpus (`LIV-Aino-M` alongside `LIV-VNC-CHSTNT-XL`), and the waist/
 * length size is written both `28/34` and `2834`.
 */
export function normalizeSku(raw: string): string {
  let s = raw.trim().toUpperCase();
  s = s.replace(/[_\s]+/g, "-"); // underscores and spaces are separators
  s = s.replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  // Waist/length: 28/34 -> 2834, so the two spellings compare equal.
  s = s.replace(/(^|-)(\d{2})\/(\d{2})($|-)/g, "$1$2$3$4");
  return s;
}

export function skuTokens(sku: string): string[] {
  return normalizeSku(sku).split("-").filter(Boolean);
}

export interface SkuParts {
  /** Modifier prefixes that make this a distinct product (IMP, OLD, …). */
  modifiers: string[];
  /** Owner prefix: LIV, EXT, VN, CHIMI … */
  prefix: string | null;
  /** Style and colour tokens — the descriptive middle. */
  body: string[];
  /** Trailing size token, if the last segment looks like one. */
  size: string | null;
  normalized: string;
}

export function parseSku(raw: string): SkuParts {
  const tokens = skuTokens(raw);
  const modifiers: string[] = [];
  let i = 0;
  while (i < tokens.length && (MEANINGFUL_PREFIXES as readonly string[]).includes(tokens[i])) {
    modifiers.push(tokens[i]);
    i++;
  }
  let prefix: string | null = null;
  if (i < tokens.length) {
    prefix = PREFIX_TYPOS[tokens[i]] ?? tokens[i];
    i++;
  }
  const rest = tokens.slice(i);

  let size: string | null = null;
  if (rest.length > 1) {
    const last = rest[rest.length - 1];
    if (SIZE_WORDS.has(last) || /^\d{4}$/.test(last) || /^\d{2}$/.test(last)) {
      size = last;
      rest.pop();
    }
  }
  return { modifiers, prefix, body: rest, size, normalized: normalizeSku(raw) };
}

/** Letters and digits only — for comparing across differing abbreviations. */
function core(parts: SkuParts): string {
  return [...parts.modifiers, parts.prefix ?? "", ...parts.body].join("").replace(/[^A-Z0-9]/g, "");
}

export type MatchConfidence = "certain" | "likely" | "possible";

// NOTE: only "certain" is produced today — see the measurement note in
// compareSku. The looser tiers remain in the type so a reviewed, human-
// confirmed duplicate queue can use them without a signature change.

export interface SkuMatch {
  sku: string;
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Compare a proposed SKU against one that already exists.
 *
 * Returns null when they are different products. The two hard rules come before
 * any fuzzy matching, because both describe deliberate distinctions that a
 * similarity score would otherwise flatten:
 *
 *   - different modifiers (IMP-) — an imperfect is its own product
 *   - different size — a different variant, not a duplicate
 */
export function compareSku(candidate: string, existing: string): SkuMatch | null {
  const a = parseSku(candidate);
  const b = parseSku(existing);

  if (a.normalized === b.normalized) {
    return { sku: existing, confidence: "certain", reason: "identical after normalisation" };
  }
  // Deliberate distinctions — never duplicates.
  if (a.modifiers.join("-") !== b.modifiers.join("-")) return null;
  if ((a.size ?? "") !== (b.size ?? "")) return null;
  if (!a.body.length || !b.body.length) return null;

  const ca = core(a), cb = core(b);

  if (a.prefix !== b.prefix && ca === cb) {
    return {
      sku: existing,
      confidence: "certain",
      reason: `prefix "${b.prefix}" vs "${a.prefix}" — same product body`,
    };
  }
  if (ca === cb) {
    return { sku: existing, confidence: "certain", reason: "same tokens, different grouping" };
  }
  if (a.prefix !== b.prefix) return null;

  // Same tokens in a different order — a regrouping, not a new product.
  const ma = [...a.body].sort().join("-");
  const mb = [...b.body].sort().join("-");
  if (ma === mb) {
    return { sku: existing, confidence: "certain", reason: "same tokens, reordered" };
  }

  // Deliberately nothing beyond this point. Every rule above is exact; the
  // three tiers together produce ZERO false positives across the 9,822-SKU CFO
  // ledger, which is what makes them safe to enforce as a hard error.
  //
  // Two looser rules were tried and measured, then removed:
  //
  //   abbreviation + shared-token score   17,277 false pairs
  //   one character's difference             522 false pairs
  //
  // The second is the instructive one: LIV-TIM-GRN-BND-L and LIV-TIM-GRY-BND-L
  // differ by one character and are green and grey. Abbreviated colour tokens
  // are three letters, so a single character *is* the distinction. Neither rule
  // can work, because SKU strings in one family legitimately look alike —
  // LIV-HYS-SNGL-BRSTD-JCKT-GRY-L and LIV-HYS-DBL-BRSTD-JCKT-BRWN-L are a
  // different cut in a different colour, and are no more distinguishable by
  // string than LIV-KRI-DWN is from LIV-KR-JPN-DWN, which *is* a duplicate.
  //
  // So string similarity is not where duplicates get caught. Two things catch
  // them, both elsewhere in this build:
  //   - the unique index on Variant.barcode (the deterministic signal: one
  //     garment, one barcode — this is how Cin7's 75 twins were found);
  //   - buildSku() below, which makes the same garment produce the same string,
  //     so a second entry collides instead of coexisting.
  return null;
}

export interface SkuInput {
  /** Owner prefix — LIV for Livid production, EXT for external brands. */
  prefix: string;
  /**
   * Brand token, for external product. The corpus writes the brand between the
   * prefix and the style — EXT-PB-BARTH-… for Paraboot, EXT-NRD-… for Norda —
   * so a Livid SKU omits it and an external one carries it.
   */
  brand?: string;
  /** Modifiers that make this a distinct product: IMP for an imperfect. */
  modifiers?: string[];
  /** Style name, e.g. "Keri Japan". */
  style: string;
  /** Colourway name, e.g. "Black Linen". */
  color?: string;
  /** Size label, e.g. "M" or "30/34". */
  size?: string;
}

/**
 * Abbreviate a word the way the existing corpus does: drop vowels after the
 * first letter, cap the length. BLACK -> BLCK, LINEN -> LNN, JAPAN -> JPN.
 * Matches the convention actually in use rather than imposing a new one.
 */
function abbreviate(word: string, max = 5): string {
  const w = word.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!w) return "";
  if (/\d/.test(w) || w.length <= 3) return w;
  const out = w[0] + w.slice(1).replace(/[AEIOU]/g, "");
  return (out.length >= 2 ? out : w).slice(0, max);
}

/**
 * Build the SKU for a garment from its attributes.
 *
 * This is the structural fix for duplicates. Detection can only ever be a
 * guess; generation makes two people entering the same garment produce the
 * same string, at which point the existing unique index rejects the second one.
 */
export function buildSku(input: SkuInput): string {
  const parts = [
    ...(input.modifiers ?? []).map((m) => m.toUpperCase()),
    input.prefix.toUpperCase(),
    ...(input.brand ? [abbreviate(input.brand, 4)] : []),
    ...input.style.split(/[\s/-]+/).filter(Boolean).map((w) => abbreviate(w)),
    ...(input.color ?? "").split(/[\s/-]+/).filter(Boolean).map((w) => abbreviate(w)),
    ...(input.size ? [input.size] : []),
  ].filter(Boolean);
  return normalizeSku(parts.join("-"));
}

const RANK: Record<MatchConfidence, number> = { certain: 0, likely: 1, possible: 2 };

/** Rank a candidate against a corpus of existing SKUs. */
export function findNearDuplicates(
  candidate: string,
  existing: Iterable<string>,
  limit = 5
): SkuMatch[] {
  const out: SkuMatch[] = [];
  for (const e of existing) {
    const m = compareSku(candidate, e);
    if (m) out.push(m);
  }
  out.sort((x, y) => RANK[x.confidence] - RANK[y.confidence] || x.sku.localeCompare(y.sku));
  return out.slice(0, limit);
}

export interface SkuValidation {
  ok: boolean;
  normalized: string;
  errors: string[];
  warnings: string[];
  matches: SkuMatch[];
}

/**
 * Validate a proposed SKU for creation.
 *
 * `certain` matches are errors — they are the same product. `likely` and
 * `possible` are warnings the user confirms past, because the corpus contains
 * legitimately similar SKUs and a hard block would be wrong more often than right.
 */
export function validateSku(candidate: string, existing: Iterable<string>): SkuValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = normalizeSku(candidate);

  if (!normalized) errors.push("SKU is empty");
  if (!/^[A-Z0-9./-]+$/.test(normalized)) {
    errors.push("SKU may only contain letters, digits, dots, slashes and hyphens");
  }
  if (normalized !== candidate.trim()) {
    warnings.push(`will be stored as "${normalized}"`);
  }
  const parts = parseSku(candidate);
  if (!parts.prefix) errors.push("SKU has no owner prefix (LIV, EXT, …)");
  if (PREFIX_TYPOS[skuTokens(candidate)[parts.modifiers.length]]) {
    warnings.push(
      `prefix "${skuTokens(candidate)[parts.modifiers.length]}" looks like a typo for "${parts.prefix}"`
    );
  }

  const matches = findNearDuplicates(candidate, existing);
  for (const m of matches) {
    const msg = `${m.sku} — ${m.reason}`;
    if (m.confidence === "certain") errors.push(`duplicate of ${msg}`);
    else warnings.push(`similar to ${msg}`);
  }
  return { ok: errors.length === 0, normalized, errors, warnings, matches };
}

// ---------------------------------------------------------------------------
// Three-level generation, for the product builder
// ---------------------------------------------------------------------------
//
// buildSku above produces one flat string and is kept for its existing callers.
// The builder needs the three levels to agree, because the master's structure is
// Style -> Colorway -> Variant and the SKUs have to mirror it:
//
//   styleSku     EXT-PRBT-AVR-VLLGR
//   colorwaySku  EXT-PRBT-AVR-VLLGR-DRK-BRWN      = styleSku + colour tokens
//   variantSku   EXT-PRBT-AVR-VLLGR-DRK-BRWN-9.5  = colorwaySku + "-" + size
//
// The invariant `variantSku === colorwaySku + "-" + skuToken` is relied on by
// pio.ts (stem derivation), cin7/import.ts (base/size split) and
// normalize-size-labels.ts. Nothing may break it — which is why a disambiguating
// suffix goes on the colorway, before the size, and never after it.

/** Owner prefix. EXT for external brands, LIV for Livid's own production. */
export type SkuPrefix = "EXT" | "LIV";

export interface StyleSkuInput {
  prefix: SkuPrefix;
  /**
   * The brand's token, when it has one. `Brand.skuToken` exists because the
   * abbreviation rule cannot reach the spellings the corpus actually uses:
   * abbreviate("Vintage", 4) is VNTG where the corpus writes VN, and Paraboot is
   * PB in every one of its rows where the rule gives PRBT.
   */
  brandToken?: string | null;
  /** Fallback when no token is set: abbreviate(name, 4). */
  brandName?: string | null;
  style: string;
  modifiers?: string[];
}

/**
 * EXT-PRBT-AVR-VLLGR — prefix, brand token, then one token per style word.
 *
 * A Livid SKU omits the brand segment entirely: 8,062 corpus rows are
 * LIV-<style>-<colour>-<size> with nothing between the prefix and the style.
 */
export function buildStyleSku(input: StyleSkuInput): string {
  const brand =
    input.prefix === "LIV"
      ? null
      : (input.brandToken?.trim().toUpperCase() ||
        (input.brandName ? abbreviate(input.brandName, 4) : null));

  return normalizeSku(
    [
      ...(input.modifiers ?? []).map((m) => m.toUpperCase()),
      input.prefix,
      ...(brand ? [brand] : []),
      ...styleTokens(input.style),
    ]
      .filter(Boolean)
      .join("-")
  );
}

/**
 * styleSku + one token per colourway word.
 *
 * The styleSku is passed through VERBATIM and never re-derived. That is roadmap
 * decision 2.2 made mechanical: existing SKUs are not rewritten, so a new
 * colourway of an existing style inherits whatever that style is already
 * called — EXT-PB-BARTH-HOMME included. Re-deriving is exactly how Barnes ended
 * up as both LIV-BAR and LIV-BRNS.
 */
export function buildColorwaySku(styleSku: string, color: string): string {
  return normalizeSku([normalizeSku(styleSku), ...styleTokens(color)].filter(Boolean).join("-"));
}

/**
 * colorwaySku + "-" + the size's token.
 *
 * The token is passed through verbatim: a size must never meet `abbreviate`,
 * which would turn "9.5" into "95" and "OS" into itself only by luck.
 */
export function buildVariantSku(colorwaySku: string, skuToken: string): string {
  const size = skuToken.trim().toUpperCase();
  if (!size) return normalizeSku(colorwaySku);
  return normalizeSku(`${normalizeSku(colorwaySku)}-${size}`);
}

/**
 * The SKU token for a size.
 *
 * 2-D folds to four digits — "32" + "34" -> "3234" — and that is not cosmetic.
 * `deriveSize` in threadflow/sync.ts and cin7/import.ts both test `/^\d{4}$/`
 * on the trailing token to recover waist and length, and `parseSku` recognises
 * `\d{4}` as a size. A "-W32-L32" spelling would make a new 2-D garment
 * invisible to duplicate detection and to both importers. normalizeSku already
 * folds the 44 legacy slashed rows (28/34) to the same form.
 */
export function sizeSkuToken(entry: { dim1: string; dim2?: string | null }): string {
  const a = entry.dim1.trim().toUpperCase();
  const b = entry.dim2?.trim().toUpperCase();
  return b ? `${a}${b}` : a;
}

/** Split a name into words and abbreviate each the way the corpus does. */
function styleTokens(value: string): string[] {
  return value
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((w) => abbreviate(w));
}

/**
 * One-of-one stock: vintage, where two garments legitimately share a name.
 *
 * Six second-hand Tommy Hilfiger shirts in XL are six garments with six SKUs and
 * one name — they account for 138 of the 166 raw name collisions. The regex has
 * lived unexported in duplicate-candidates.ts; it belongs here, because the SKU
 * generator needs the same distinction the duplicate detector does.
 */
export function isOneOfOne(sku: string): boolean {
  return /^(VN-|EXT-VN-)/.test(normalizeSku(sku));
}

export interface SuffixOptions {
  /** Highest suffix to try. 49 has never been approached. */
  max?: number;
}

/**
 * Append -2, -3 … until the SKU is free.
 *
 * Use this ONLY where two different garments may legitimately generate the same
 * string — which in this catalogue means one-of-one vintage and nothing else.
 *
 * Everywhere else a collision is not a coincidence to route around: a generated
 * colorwaySku is a pure function of (brand token, style, colour), so if it is
 * taken then the row that holds it has the same brand, style and colour, and
 * suffixing would quietly create a second record for one garment. That is the
 * failure this whole module exists to prevent, so the caller must block instead.
 */
export function suffixUntilFree(
  base: string,
  isTaken: (candidate: string) => boolean,
  opts: SuffixOptions = {}
): string | null {
  const max = opts.max ?? 49;
  const normalized = normalizeSku(base);
  if (!isTaken(normalized)) return normalized;
  for (let n = 2; n <= max; n++) {
    const next = `${normalized}-${n}`;
    if (!isTaken(next)) return next;
  }
  return null;
}
