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
export type ShopifyReadinessProfile = "mainline" | "external" | "vintage";

export interface ShopifyReadinessInput {
  hasVariants: boolean;
  hasPrice: boolean;
  /** Shopify-resolved description (override -> base). */
  description?: string | null;
  /** At least one image the storefront can show. */
  hasImage?: boolean;
  hasTags?: boolean;
  swatchHex?: string | null;
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
 * The care page and the fit guide are NOT part of this (2026-10-15). They were,
 * and they blocked 1,505 of Livid's 1,682 non-vintage colorways and 1,097 of the
 * 1,258 externals — 88% of everything judged against them. A condition that
 * nearly nothing satisfies is not a standard being enforced, it is a gate that
 * has to be waived to get any work done, and `allowIncomplete` waives the image
 * check with it. They are still edited and still pushed; they just no longer
 * decide whether a product may go live.
 *
 * The swatch survives for Livid's own production and is waived for externals and
 * vintage. A Livid colourway IS a colour decision and the hex is the master's to
 * hold; a bought-in Paraboot or a one-of-one garment is not, which 1,253 of 1,258
 * externals holding no swatch says plainly enough.
 *
 * What is left — variants, price, description, image, tags — is the part that
 * decides whether a customer should see the page at all. The alternative, pushing
 * with `allowIncomplete`, waives the image check too, and a product going live
 * with no photograph is the failure this gate exists to prevent. The exceptions
 * live here rather than at the call site because this module is the single source
 * of truth: the badge and the push must not drift.
 */
export function shopifyMissing(i: ShopifyReadinessInput): string[] {
  const missing: string[] = [];
  if (!i.hasVariants) missing.push("variants");
  if (!i.hasPrice) missing.push("price");
  if (!has(i.description)) missing.push("description");
  if (i.hasImage === false) missing.push("image");
  if (i.hasTags === false) missing.push("tags");
  if ((i.profile ?? "mainline") === "mainline" && !has(i.swatchHex)) missing.push("swatch");
  return missing;
}

/**
 * The readiness profile a colorway is judged against.
 *
 * Keyed off the brand, like `isLoomEligible` and `BrandScope` — it is a fact
 * about what the product IS, not a per-product intent someone can tick wrong.
 * Deliberately not keyed off `Source`: the 2,086 online-vintage rows arrived as
 * CIN7_IMPORT and `Source` becomes pure history once Cin7 retires.
 *
 * Takes the brand rather than its name because "external" is `isLivid === false`,
 * the same discriminator `/catalog/external` uses. The whole object, and
 * `isLivid` is REQUIRED on it rather than optional: a query that selected only
 * the name would otherwise compile and quietly judge every Livid product as an
 * external, which is the exact drift this module exists to prevent.
 *
 * Note that "external" and "vintage" currently differ in nothing the gate reads.
 * They stay separate because callers outside the gate branch on "vintage" for an
 * unrelated reason — vintage keeps the full declarative Shopify push, everything
 * else sends only what changed — and collapsing the two would quietly put every
 * external on that path.
 */
export function readinessProfileFor(
  brand: { name?: string | null; isLivid: boolean | null } | null | undefined
): ShopifyReadinessProfile {
  if (brand?.name?.trim().toLowerCase() === "vintage") return "vintage";
  return brand?.isLivid === true ? "mainline" : "external";
}

/** The subset that stops a product being orderable at all. */
export function shopifyBlockingMissing(i: ShopifyReadinessInput): string[] {
  return shopifyMissing(i).filter((m) => m === "variants" || m === "price");
}

/**
 * What may REFUSE a push, which is not the same as what is missing.
 *
 * The gate asks "is this safe to put in front of a customer for the first
 * time?". For a create that is exactly right. For an update it is the wrong
 * question: the product is already live with whatever Shopify holds, and the
 * push does not overwrite what the master is empty on — `descriptionHtml` goes
 * out for vintage only, `files` only when the master actually has media, and a
 * blank metafield is left alone unless `clearEmptied` asks for it to be erased.
 *
 * So on an update the merchandising fields say what the MASTER lacks, not what
 * the customer would see. Refusing on them blocked safe work: all five Tarvas
 * products are live on Shopify and hold none of their copy in Origio, which made
 * a price change impossible without `allowIncomplete` — a flag that also waives
 * the image check, so the one guard worth keeping was the price of the one that
 * should not have applied.
 *
 * `clearEmptied` restores the full gate, because with it a blank IS an
 * instruction to erase.
 *
 * Lives here, beside `shopifyMissing`, because the badge and the live push must
 * answer this identically — that is the whole reason this module exists.
 */
export function shopifyRefusing(
  i: ShopifyReadinessInput,
  ctx: { action: "create" | "update"; clearEmptied?: boolean }
): string[] {
  return ctx.action === "create" || ctx.clearEmptied
    ? shopifyMissing(i)
    : shopifyBlockingMissing(i);
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
