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
