// Category vocabulary for the Loom feed.
//
// Loom's catalogue grouping, merchandising order and customer-facing filters
// all key off category, so a split vocabulary fragments their catalogue. Our
// master carries 76 distinct values because Cin7's category field flowed
// through untouched — we normalise at the feed boundary rather than rewriting
// the master, so what Cin7 holds internally never reaches Loom.
//
// Agreed with Livid/Loom, 1 September 2026.
const TO_LOOM: Record<string, string> = {
  // Loom uses Jersey for tees, singlets, sweats and longsleeves.
  "t-shirt": "Jersey",
  "tee": "Jersey",
  "singlet": "Jersey",
  "sweatshirt": "Jersey",
  "longsleeve": "Jersey",
  // …and Outerwear for jackets and coats.
  "jacket": "Outerwear",
  "coat": "Outerwear",
  // Scarf and Cap have no Loom equivalent; confirmed as Accessories.
  "scarf": "Accessories",
  "cap": "Accessories",
  // Suit trousers stay distinguishable by style name, not by category.
  "suitpant": "Trouser",
};

// A note on what deliberately is NOT in the map above, 2026-09-18.
//
// 104 Livid colorways reach the wholesale catalogue carrying values outside
// LOOM_CATEGORIES — "Hats", "Hat", "Beanie", "Belt", "Bags", "Top" — and the
// obvious fix looks like adding them here next to `cap` and `scarf`. It is the
// wrong place. This map applies to BOTH modes, so collapsing "Sunglasses" or
// "Sweater" into Accessories/Knitwear here would also flatten them on the
// stock-registry rows, and the Loom stock report is filtered by category. That
// would make the report less useful in order to tidy the catalogue.
//
// Those belong in `Category.loomCategory` instead — per category, visible on
// /catalog/categories, and reversible. `loomCategoryFor` already prefers it over
// this map. Accessories is one of the eleven, so the screen can already express
// every one of the 104 today.

/** Loom's live vocabulary — anything outside it is passed through untouched. */
export const LOOM_CATEGORIES = [
  "Jersey", "Outerwear", "Accessories", "Trouser",
  "Shirt", "Knitwear", "Jeans", "Suiting", "Shorts", "Dress", "Skirt",
] as const;

/** Map one of our category values onto Loom's vocabulary. */
export function toLoomCategory(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "Uncategorized";
  return TO_LOOM[v.toLowerCase()] ?? v;
}

/**
 * Loom's category for a product, preferring the modelled one.
 *
 * `toLoomCategory` guesses from free text and is right for the ~4,500 rows that
 * only ever had free text. Where a Category has been mapped deliberately — the
 * review screen's whole purpose — that mapping wins, because someone chose it.
 * The fallback keeps working untouched, so this can be adopted one product at a
 * time rather than in a backfill.
 */
export function loomCategoryFor(
  ref: { loomCategory: string | null } | null | undefined,
  fallback: string | null | undefined
): string {
  const mapped = ref?.loomCategory?.trim();
  return mapped ? mapped : toLoomCategory(fallback);
}
