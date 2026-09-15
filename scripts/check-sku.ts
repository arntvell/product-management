// Assertions over the SKU generator. There is no test runner in this repo, so
// this is a script you run:
//
//   npx tsx scripts/check-sku.ts
//
// It is pure — sku.ts imports nothing — so it needs no database and no
// credentials. Exit code 1 on any failure.
//
// The cases here are the ones that have actually cost something: the worked
// example the convention is specified by, the four-digit 2-D token both
// importers parse, the half size that abbreviate() would destroy, the invariant
// that a variant SKU is its colorway SKU plus a size, and the one-of-one rule
// that decides whether a collision may be suffixed or must block.

import {
  buildStyleSku, buildColorwaySku, buildVariantSku, sizeSkuToken,
  isOneOfOne, suffixUntilFree, normalizeSku, parseSku,
} from "../src/lib/master/sku.ts";

let fail = 0;
const eq = (label: string, got: string | null, want: string | null) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}\n        got ${got}\n        want ${want}`);
};

// The worked example from the plan, both ways.
const paraboot = { prefix: "EXT" as const, brandName: "Paraboot", style: "Avarua Villager" };
const styleA = buildStyleSku(paraboot);
eq("style, no skuToken", styleA, "EXT-PRBT-AVR-VLLGR");
const cwA = buildColorwaySku(styleA, "Dark Brown");
eq("colorway", cwA, "EXT-PRBT-AVR-VLLGR-DRK-BRWN");
eq("variant 9.5", buildVariantSku(cwA, "9.5"), "EXT-PRBT-AVR-VLLGR-DRK-BRWN-9.5");

const styleB = buildStyleSku({ ...paraboot, brandToken: "PB" });
eq("style, skuToken PB", styleB, "EXT-PB-AVR-VLLGR");

// Vintage — the reason skuToken exists at all.
eq("vintage token", buildStyleSku({ prefix: "EXT", brandName: "Vintage", style: "Tommy Shirt" }), "EXT-VNTG-TMMY-SHRT");
eq("vintage w/ token", buildStyleSku({ prefix: "EXT", brandToken: "VN", brandName: "Vintage", style: "Tommy Shirt" }), "EXT-VN-TMMY-SHRT");

// Livid omits the brand segment.
eq("livid style", buildStyleSku({ prefix: "LIV", brandName: "Livid", style: "Barnes Japan" }), "LIV-BRNS-JPN");

// Size tokens.
eq("2-D token", sizeSkuToken({ dim1: "32", dim2: "34" }), "3234");
eq("1-D token", sizeSkuToken({ dim1: "M" }), "M");
eq("half size token", sizeSkuToken({ dim1: "9.5" }), "9.5");
eq("one size", buildVariantSku("EXT-PF-PIN", "OS"), "EXT-PF-PIN-OS");

// The invariant the importers depend on: a 2-D variant SKU must end in 4 digits
// and parseSku must read it back as a size.
const jeans = buildVariantSku("LIV-BRNS-JPN-DWN", sizeSkuToken({ dim1: "32", dim2: "34" }));
eq("2-D variant sku", jeans, "LIV-BRNS-JPN-DWN-3234");
eq("parseSku recovers the size", parseSku(jeans).size, "3234");
eq("legacy slashed folds the same", normalizeSku("LIV-BRNS-JPN-DWN-32/34"), jeans);

// The invariant: variantSku === colorwaySku + "-" + token
const cw = "EXT-VN-TMMY-SHRT-2";
eq("suffix before size", buildVariantSku(cw, "XL"), "EXT-VN-TMMY-SHRT-2-XL");

// One-of-one detection.
eq("VN- is one-of-one", String(isOneOfOne("VN-ONLN-10023-OS")), "true");
eq("EXT-VN- is one-of-one", String(isOneOfOne("EXT-VN-TMMY-SHRT")), "true");
eq("EXT- is not", String(isOneOfOne("EXT-PRBT-AVR")), "false");

// Suffixing.
const taken = new Set(["EXT-VN-TMMY-SHRT", "EXT-VN-TMMY-SHRT-2"]);
eq("suffix skips taken", suffixUntilFree("EXT-VN-TMMY-SHRT", (c) => taken.has(c)), "EXT-VN-TMMY-SHRT-3");
eq("suffix no-op when free", suffixUntilFree("EXT-VN-OTHER", (c) => taken.has(c)), "EXT-VN-OTHER");

console.log(fail ? `\n${fail} FAILURES` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
