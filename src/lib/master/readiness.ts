// Shared readiness predicates — the SINGLE source of truth for "is this
// colorway safe to push?". Both the publishing UI (advisory badges) and the
// live push (hard gating) call these, so what the badge says and what the push
// enforces can never drift apart.
//
// Pure functions over primitives so every caller (list query, Shopify push,
// Loom push) can feed them from its own query shape.

function has(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Channel eligibility — which channels a product may go to AT ALL.
// ---------------------------------------------------------------------------
//
// Distinct from readiness: readiness asks "is this product complete enough to
// push?", eligibility asks "should this product ever go there?". Loom is the
// B2B wholesale channel for Livid's own production. External brands are resold
// goods and vintage is one-of-one stock; neither is wholesaled, so neither
// belongs on Loom -- ever, regardless of how complete it is.
//
// Derived from the brand rather than stored per product, because it is a fact
// about what the product IS, not a per-product intent someone can tick wrong.
// It deliberately does NOT key off `Source`: a Livid garment is Livid whether
// it arrived through Threadflow or the Cin7 import (87 of the Loom
// publications to date are Cin7-sourced), and `Source` becomes pure history
// once Cin7 is retired.

export interface EligibilityInput {
  /** Brand.isLivid — the one brand flagged as Livid's own production. */
  brandIsLivid: boolean | null | undefined;
}

/**
 * Loom does two jobs, and they have opposite eligibility rules.
 *
 *   "catalogue"  the B2B wholesale catalogue. Livid's own production only —
 *                external brands are resold goods and vintage is one-of-one
 *                stock, so neither is wholesaled however complete its data is.
 *
 *   "registry"   the stock registry, carrying movements between Sitoo and
 *                Shopify while their direct integration is postponed. This has
 *                to see EVERYTHING that moves: externals are bought-in goods
 *                and vintage sells weekly, so excluding them would mean their
 *                stock silently does not reconcile.
 *
 * Applying the catalogue rule to the registry is a real hazard rather than a
 * hypothetical one — it would drop 1,545 EXT, 390 VN-ONLN and 70 CHIMI
 * identities from the missing-4,552 alone, plus every external already held.
 */
export type LoomPurpose = "catalogue" | "registry";

export function isLoomEligible(i: EligibilityInput, purpose: LoomPurpose = "catalogue"): boolean {
  if (purpose === "registry") return true;
  return i.brandIsLivid === true;
}

/** Everything the master holds can be sold direct-to-consumer. */
export function isShopifyEligible(_i: EligibilityInput): boolean {
  return true;
}

/** Human-readable reason, for skip lists and UI. Null when eligible. */
export function loomIneligibleReason(
  i: EligibilityInput,
  purpose: LoomPurpose = "catalogue"
): string | null {
  return isLoomEligible(i, purpose)
    ? null
    : "not a Livid-brand product — the Loom wholesale catalogue carries Livid production only";
}

/** The Loom job a push mode serves. "data" is the stock registry. */
export function purposeForMode(mode: "full" | "data" | undefined): LoomPurpose {
  return mode === "data" ? "registry" : "catalogue";
}

/**
 * Which profile of the gate a product is judged against.
 *
 * "mainline"  everything Livid and its resold brands sell as a production run.
 * "vintage"   a one-of-one second-hand garment. It has no swatch, no care page
 *             and no fit guide, and never will — there is one of it, and no
 *             production data behind it. Judged against the mainline profile it
 *             fails 100% of the time.
 */
export type ShopifyReadinessProfile = "mainline" | "vintage";

export interface ShopifyReadinessInput {
  hasVariants: boolean;
  hasPrice: boolean;
  /** Shopify-resolved description (override -> base). */
  description?: string | null;
  /** At least one image the storefront can show. */
  hasImage?: boolean;
  hasTags?: boolean;
  swatchHex?: string | null;
  carePageId?: string | null;
  fitguidePageId?: string | null;
  /** Defaults to "mainline" so every existing caller is unchanged. */
  profile?: ShopifyReadinessProfile;
}

/**
 * Missing fields that block a Shopify push. Empty array = ready.
 *
 * Variants and price make a product *orderable*; they do not make it
 * *sellable*. A product page with no description and no photograph is not
 * something to put in front of a customer, and checking only the commerce
 * fields meant the app reported 226 FW26 products ready when none had either.
 * The merchandising fields are part of the gate for that reason.
 *
 * Vintage waives exactly three references it can never hold, and nothing else:
 * variants, price, description, image and tags stay required. The alternative —
 * pushing vintage with `allowIncomplete` — waives the image check too, and a
 * product going live with no photograph is the failure this gate exists to
 * prevent. The exception lives here rather than at the call site because this
 * module is the single source of truth: the badge and the push must not drift.
 */
export function shopifyMissing(i: ShopifyReadinessInput): string[] {
  const missing: string[] = [];
  if (!i.hasVariants) missing.push("variants");
  if (!i.hasPrice) missing.push("price");
  if (!has(i.description)) missing.push("description");
  if (i.hasImage === false) missing.push("image");
  if (i.hasTags === false) missing.push("tags");
  if (i.profile !== "vintage") {
    if (!has(i.swatchHex)) missing.push("swatch");
    if (!has(i.carePageId)) missing.push("care page");
    if (!has(i.fitguidePageId)) missing.push("fit guide");
  }
  return missing;
}

/**
 * The readiness profile a colorway is judged against.
 *
 * Keyed off the brand, like `isLoomEligible` — it is a fact about what the
 * product IS, not a per-product intent someone can tick wrong. Deliberately not
 * keyed off `Source`: the 2,086 online-vintage rows arrived as CIN7_IMPORT and
 * `Source` becomes pure history once Cin7 retires.
 */
export function readinessProfileFor(brandName: string | null | undefined): ShopifyReadinessProfile {
  return brandName?.trim().toLowerCase() === "vintage" ? "vintage" : "mainline";
}

/** The subset that stops a product being orderable at all. */
export function shopifyBlockingMissing(i: ShopifyReadinessInput): string[] {
  return shopifyMissing(i).filter((m) => m === "variants" || m === "price");
}

export interface LoomReadinessInput {
  hasVariants: boolean;
  hasPrice: boolean;
  hsCode: string | null | undefined;
  customsDescription: string | null | undefined;
  weightKg: unknown; // Decimal | number | null
  fiberComposition: string | null | undefined;
  countryOfOrigin: string | null | undefined;
  hasManufacturer: boolean;
}

/** Missing fields that block a Loom push. Empty array = ready. */
export function loomMissing(i: LoomReadinessInput): string[] {
  const missing: string[] = [];
  if (!i.hasVariants) missing.push("variants");
  if (!i.hasPrice) missing.push("price");
  if (!has(i.hsCode)) missing.push("HS code");
  if (!has(i.customsDescription)) missing.push("customs desc");
  if (i.weightKg == null) missing.push("weight");
  if (!has(i.fiberComposition)) missing.push("fibre");
  if (!has(i.countryOfOrigin)) missing.push("origin");
  if (!i.hasManufacturer) missing.push("manufacturer");
  return missing;
}
