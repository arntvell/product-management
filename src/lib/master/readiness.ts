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
}

/**
 * Missing fields that block a Shopify push. Empty array = ready.
 *
 * Variants and price make a product *orderable*; they do not make it
 * *sellable*. A product page with no description and no photograph is not
 * something to put in front of a customer, and checking only the commerce
 * fields meant the app reported 226 FW26 products ready when none had either.
 * The merchandising fields are part of the gate for that reason.
 */
export function shopifyMissing(i: ShopifyReadinessInput): string[] {
  const missing: string[] = [];
  if (!i.hasVariants) missing.push("variants");
  if (!i.hasPrice) missing.push("price");
  if (!has(i.description)) missing.push("description");
  if (i.hasImage === false) missing.push("image");
  if (i.hasTags === false) missing.push("tags");
  if (!has(i.swatchHex)) missing.push("swatch");
  if (!has(i.carePageId)) missing.push("care page");
  if (!has(i.fitguidePageId)) missing.push("fit guide");
  return missing;
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
