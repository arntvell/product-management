// Run: npx tsx --test src/lib/partner/partner-rules.test.ts
// Pure rules only: the one database there is, is production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseToken, matchBrand, takenTokens, type BrandRow } from "./brand-rules";
import { checkAmounts } from "./season-assignments";

const row = (p: Partial<BrandRow> & { id: string; name: string }): BrandRow => ({
  isLivid: false,
  skuToken: null,
  loomBrandId: null,
  archived: false,
  mergedIntoId: null,
  ...p,
});

const BRANDS: BrandRow[] = [
  row({ id: "cnvr", name: "Converse", skuToken: "CNVR" }),
  row({ id: "pb", name: "Paraboot", skuToken: "PB", loomBrandId: "loom-pb" }),
  row({ id: "pfc", name: "P.F. Candle Co.", skuToken: "PFC" }),
  row({ id: "old", name: "Norda Run", mergedIntoId: "norda" }),
  row({ id: "norda", name: "Norda", skuToken: "NRD" }),
  row({ id: "keen", name: "Keen" }), // no token: derives KN (K + consonants)
];

test("loom_brand_id wins over the name", () => {
  const m = matchBrand({ loom_brand_id: "loom-pb", name: "Something else" }, BRANDS);
  assert.equal(m.kind, "found");
  assert.equal(m.kind === "found" && m.brand.id, "pb");
});

test("the name matches with case and punctuation ignored", () => {
  const m = matchBrand({ name: "CONVERSE" }, BRANDS);
  assert.ok(m.kind === "found" && m.brand.id === "cnvr" && m.by === "name");
  const n = matchBrand({ name: "pf candle co" }, BRANDS);
  assert.ok(n.kind === "found" && n.brand.id === "pfc");
});

test("a merged brand resolves to the one it was merged into", () => {
  const m = matchBrand({ name: "Norda Run" }, BRANDS);
  assert.ok(m.kind === "found" && m.brand.id === "norda");
});

test("a brand linked to another Loom id is refused", () => {
  const m = matchBrand({ loom_brand_id: "loom-other", name: "Paraboot" }, BRANDS);
  assert.equal(m.kind, "refuse");
});

test("a near miss is refused rather than created", () => {
  const m = matchBrand({ name: "Conversee" }, BRANDS);
  assert.equal(m.kind, "refuse");
  assert.match(m.kind === "refuse" ? m.error : "", /Converse/);
});

test("an unknown name is new", () => {
  assert.deepEqual(matchBrand({ name: "Eyyts Studio" }, BRANDS), { kind: "none" });
});

test("tokens in use: stored, derived and seen in style SKUs", () => {
  const taken = takenTokens(BRANDS, [{ styleSku: "EXT-BS-ARIZ", brandName: "Birkenstock" }]);
  assert.equal(taken.get("CNVR"), "Converse");
  assert.equal(taken.get("KN"), "Keen"); // derived
  assert.equal(taken.get("BS"), "Birkenstock"); // corpus
  assert.equal(taken.has("NRDR"), false); // merged brands do not hold a token
});

test("a new brand takes the derived token when it is free", () => {
  const taken = takenTokens(BRANDS, []);
  const c = chooseToken("Eyyts", null, taken);
  assert.deepEqual(c, { ok: true, token: "EYYT", source: "derived" });
});

test("a given token is used, and refused when taken", () => {
  const taken = takenTokens(BRANDS, []);
  assert.deepEqual(chooseToken("Diemme", "DM", taken), { ok: true, token: "DM", source: "given" });
  const c = chooseToken("Paraboot Two", "PB", taken);
  assert.equal(c.ok, false);
});

test("a derived token that is taken asks for sku_token instead of guessing", () => {
  const taken = takenTokens(BRANDS, []);
  const c = chooseToken("Kaan", null, taken); // derives KN, which Keen holds
  assert.equal(c.ok, false);
  assert.match(!c.ok ? c.error : "", /send sku_token/);
});

test("reserved prefixes are not tokens", () => {
  assert.equal(chooseToken("Old Co", "OLD", new Map()).ok, false);
  assert.equal(chooseToken("Ext", "EXT", new Map()).ok, false);
});

test("season prices must be numbers", () => {
  assert.equal(checkAmounts({ msrp_nok: 2499 }), null);
  assert.equal(checkAmounts({ msrp_nok: 2499, cost_nok: 0 }), null);
  assert.notEqual(checkAmounts({ msrp_nok: 0 }), null);
  assert.notEqual(checkAmounts({ msrp_nok: "2499" }), null);
  assert.notEqual(checkAmounts({ msrp_nok: 2499, cost_nok: -1 }), null);
});
