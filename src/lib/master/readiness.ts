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
}

/** Missing fields that block a Shopify push. Empty array = ready. */
export function shopifyMissing(i: ShopifyReadinessInput): string[] {
  const missing: string[] = [];
  if (!i.hasVariants) missing.push("variants");
  if (!i.hasPrice) missing.push("price");
  return missing;
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
