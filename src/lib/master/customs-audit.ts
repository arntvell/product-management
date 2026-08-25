// Sanity checks on a product's customs block.
//
// The Cin7 import fills the customs description from an "additional attribute"
// slot that turns out to be an unmaintained template: a women's skirt can carry
// "Men's Sweater - Knitted 100% wool", and a shirt named "White Fine Silk" can
// be recorded as 100% cotton. The gate only asks whether these fields are
// PRESENT, so wrong-but-present data sails through — hence these checks, which
// look for values contradicting what we otherwise know about the product.

export interface CustomsAuditInput {
  vendor: string | null;
  productType: string | null;
  /** Style name + colorway name — the fibre is often stated here. */
  displayName: string;
  customsDescription: string | null;
  fiberComposition: string | null;
}

const FIBRES = [
  "cotton", "wool", "silk", "linen", "leather", "cashmere", "denim", "alpaca", "mohair",
];

// Garment nouns we would expect a customs description to use per product type.
const TYPE_WORDS: Record<string, string[]> = {
  Jeans: ["jeans", "trouser", "denim", "pant"],
  Shirt: ["shirt"],
  Knitwear: ["sweater", "knit", "cardigan", "jumper"],
  "T-Shirt": ["t-shirt", "tshirt", "tee"],
  Jersey: ["sweatshirt", "jersey", "hoodie", "t-shirt", "sweater"],
  Outerwear: ["jacket", "coat", "parka", "outerwear"],
  Trouser: ["trouser", "pant", "chino"],
  Skirt: ["skirt"],
  Coat: ["coat", "jacket"],
  Jacket: ["jacket"],
  Scarf: ["scarf"],
  Cap: ["cap", "hat"],
  Singlet: ["singlet", "vest", "tank"],
  Suiting: ["suit", "blazer", "jacket"],
  Suitpant: ["suit", "trouser", "pant"],
  Sweater: ["sweater", "knit"],
  Shorts: ["shorts"],
  Longsleeve: ["longsleeve", "long sleeve", "shirt", "t-shirt"],
  Sweatshirt: ["sweatshirt", "sweater"],
};

/** Human-readable problems with this product's customs data (empty = fine). */
export function auditCustoms(i: CustomsAuditInput): string[] {
  const problems: string[] = [];
  const desc = (i.customsDescription ?? "").toLowerCase();
  const fibre = (i.fiberComposition ?? "").toLowerCase();
  if (!desc && !fibre) return problems;

  // A women's product described as menswear.
  if (
    i.vendor === "Livid Femme" &&
    /\bmen('|)s\b|\bmen\b/.test(desc) &&
    !/women/.test(desc)
  ) {
    problems.push("described as men's, but this is a women's product");
  }

  // The garment noun contradicts the product type.
  const expected = TYPE_WORDS[i.productType ?? ""];
  if (expected && desc && !expected.some((w) => desc.includes(w))) {
    problems.push(`described as something other than a ${i.productType}`);
  }

  // The product name states a fibre the composition contradicts.
  const name = i.displayName.toLowerCase();
  for (const f of FIBRES) {
    if (name.includes(f) && fibre && !fibre.includes(f)) {
      problems.push(`name says "${f}" but fibre is "${i.fiberComposition}"`);
    }
  }
  return problems;
}
