// Names that must not be re-grouped by their leading word.
//
// "Barnes Japan Gravel" is a colour of Barnes. "Keri Surf" is a short and not
// the Keri jeans; "Hayes Suit Jacket" is not "Hayes Suit Pant"; "Nox Blouson" is
// not "Nox". No rule separates the two cases — this is the exception list, and
// the review screen adds to it as the calls are made.
//
// The baseline lives here rather than in the migration so the report works
// before the StyleNameRule table exists and the two cannot drift. The table
// layers decisions over this list; it never replaces it.
//
// The first four entries come from master/regroup-styles.ts, which this
// supersedes. The rest were found by scanning the live catalogue for multi-word
// style names that already carry two or more colourways of their own — the
// evidence that they are garments, not colours.

export interface SeedNameRule {
  name: string;
  kind: "COMPOUND" | "PARENT_OVERRIDE";
  parent?: string;
  note?: string;
}

export const SEED_NAME_RULES: SeedNameRule[] = [
  { name: "Keri Surf", kind: "COMPOUND", note: "a short — not the Keri jeans, despite the leading word" },
  { name: "Hayes Suit Jacket", kind: "COMPOUND", note: "Hayes splits: jacket and trouser are separate garments" },
  { name: "Hayes Suit Pant", kind: "COMPOUND", note: "see Hayes Suit Jacket" },
  { name: "Nox Blouson", kind: "COMPOUND", note: "a blouson, not the Nox coat" },
  { name: "Fealy Twisted", kind: "COMPOUND", note: "carries six colourways of its own" },
  { name: "Polo Coat", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Fuller Chino", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Solace Chino", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Beth Linen", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Kaylan Trouser", kind: "COMPOUND", note: "Kaylan splits into trouser, jacket and shorts" },
  { name: "Kaylan Jacket", kind: "COMPOUND", note: "see Kaylan Trouser" },
  { name: "Kaylan Shorts", kind: "COMPOUND", note: "see Kaylan Trouser" },
  { name: "Apt Shortsleeve", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Box Shortsleeve", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Tori Twisted 5-pocket", kind: "COMPOUND", note: "carries colourways of its own" },
  { name: "Barnes Work Suit Trouser", kind: "COMPOUND", note: "carries colourways of its own" },

  // The one parent override established by hand, carried over verbatim.
  {
    name: "LIV-HNRY-NVY-PNSTRP",
    kind: "PARENT_OVERRIDE",
    parent: "Initial",
    note: "the SKU says Henrey; the name says Initial. Livid confirmed: Initial",
  },
];
