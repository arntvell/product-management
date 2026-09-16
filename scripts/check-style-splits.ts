// Pure-function checks for the style-split rules. No database, no network —
// run it with a dummy connection string, since the modules construct a Prisma
// client at import time but nothing here touches it:
//
//   ORIGO_POSTGRES_PRISMA_URL='postgresql://u:p@127.0.0.1:1/none' \
//     npx tsx scripts/check-style-splits.ts
//
// These are the rules that decide which colourway moves under which style, so
// they are worth pinning: a wrong parent is a wrong product in Loom.
import { deriveParentStyle, type KnownStyle } from "@/lib/cin7/import";
import { styleSkuFor } from "@/lib/master/sku";
import { commonWordPrefix, stripPrefix, nameForMatching, normName } from "@/lib/master/style-splits";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
};

// The bug: Threadflow's "Abby" is LIV-W-BBY, so synthesising LIV-STY-ABBY and
// looking that up missed and created a second style. The id must come back.
const vocab: KnownStyle[] = [
  { id: "tf-fealy-twisted", styleName: "Fealy Twisted" },
  { id: "tf-abby", styleName: "Abby" },
  { id: "tf-fealy", styleName: "Fealy" },
].sort((a, b) => b.styleName.length - a.styleName.length);

eq("matches by name and returns the matched style's id",
  deriveParentStyle("Abby Dull Grey Fade Out", vocab),
  { styleId: "tf-abby", styleName: "Abby", colorName: "Dull Grey Fade Out" });

eq("longest match wins — Fealy Twisted beats Fealy",
  deriveParentStyle("Fealy Twisted Japan Blown", vocab),
  { styleId: "tf-fealy-twisted", styleName: "Fealy Twisted", colorName: "Japan Blown" });

eq("an exact name is its own parent",
  deriveParentStyle("Abby", vocab),
  { styleId: "tf-abby", styleName: "Abby", colorName: "Abby" });

eq("no match returns null, so the caller mints", deriveParentStyle("Zeta Black", vocab), null);
eq("a prefix without a word boundary is not a match", deriveParentStyle("Abbygail Black", vocab), null);

// styleSkuFor must never collide with a colorway SKU, and must follow the brand.
eq("Livid keeps the LIV prefix", styleSkuFor("Riley"), "LIV-STY-RILEY");
eq("an external brand gets the EXT- grammar", styleSkuFor("Riley", "Ichi"), "EXT-ICHI-STY-RILEY");
eq("an already-prefixed token is not doubled", styleSkuFor("Riley", "EXT-ICHI"), "EXT-ICHI-STY-RILEY");
eq("punctuation collapses", styleSkuFor("L.L. Bean Shirt (L)"), "LIV-STY-L-L-BEAN-SHIRT-L");

// The "first word, sometimes the first two" rule.
eq("agrees on two words when every member does",
  commonWordPrefix(["Water Bottle 500Ml Amber", "Water Bottle 950Ml Blue", "Water Bottle 500Ml Blue"]),
  ["Water", "Bottle"]);
eq("falls back to one word when the second disagrees",
  commonWordPrefix(["Plath Black Merino", "Plath Spice Mohair Mix"]),
  ["Plath"]);
eq("an unrelated member drags the prefix down — which is why review exists",
  commonWordPrefix(["Water Bottle 500Ml Amber", "Water Lily Incense"]),
  ["Water"]);
eq("the prefix may equal a member's whole name",
  commonWordPrefix(["Water Bottle", "Water Bottle 500Ml Amber"]),
  ["Water", "Bottle"]);
eq("identical names give back the last word",
  commonWordPrefix(["Tuck Black", "Tuck Black"]),
  ["Tuck"]);

// Stripping the parent off the colourway name.
eq("strips the FULL parent, not its first word",
  stripPrefix("Hayes Suit Pant Black", "Hayes Suit Pant"), "Black");
eq("leaves a name that is exactly the parent alone",
  stripPrefix("Riley Navy", "Riley Navy"), "Riley Navy");
eq("leaves a non-match alone", stripPrefix("Keri Surf Blue", "Barnes"), "Keri Surf Blue");

// Imperfect rows carry the size in the name.
eq("strips a trailing 4-digit size", nameForMatching("Keri Japan Black, 2834*"), "Keri Japan Black");
eq("strips a spaced waist/length", nameForMatching("Barnes Forest Fog 29 34*"), "Barnes Forest Fog");
eq("leaves a plain name alone", nameForMatching("Barnes Japan Gravel"), "Barnes Japan Gravel");
eq("normName folds case and spacing", normName("  Fealy   Twisted "), "fealy twisted");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
