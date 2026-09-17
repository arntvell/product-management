// Plan the vintage colourway split. READ-ONLY: writes a plan file, nothing else.
//
// Vintage is one-of-one. Cin7's SKUs put the size last, so the importer read the
// trailing segment as a size and grouped on the rest — collapsing 514 distinct
// garments into 18 products. EXT-VN-NW-USBRSHRT became size "USBRSHRT" of a
// product called "RUGBY SHIRT"; VN-ONLN swallowed 391 garments as sizes of one
// Polo Ralph Lauren shirt.
//
// The two Levis runs are the stated exception: Levis Blue and Levis Black really
// are sold S/M/L/XL, and their Cin7 names carry the waist range to prove it.
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

// The app keeps its secrets in .env.local, which dotenv does not read by default.
config({ path: ".env.local" });

const EXCEPTIONS = ["EXT-VN-LVSN-BL", "EXT-VN-LVSN-BK"];

/**
 * Cin7's name, as the product should be called.
 *
 * Vintage names legitimately repeat — two second-hand Levi's 501 W33 are two
 * garments with one name — so nothing here tries to make them unique. It only
 * removes what is not part of the name: a one-size marker, and a size repeated
 * bare after the parenthesised one ("Crochet vest (40) 40").
 */
export function cleanName(raw) {
  let n = String(raw ?? "").trim();
  n = n.replace(/[,\s]+(OS|ONE\s?SIZE)\s*$/i, "");
  const paren = /\(([^)]{1,12})\)\s*$/.exec(n.replace(/\s+\S+\s*$/, ""));
  if (paren) {
    const inside = paren[1].trim().toLowerCase();
    n = n.replace(
      new RegExp(`\\s+${inside.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"),
      ""
    );
  }
  return n.replace(/\s{2,}/g, " ").trim();
}

const url = process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL;
const client = new pg.Client({ connectionString: url });
await client.connect();

const cin7 = JSON.parse(readFileSync(process.argv[2] ?? "snapshots/cin7_products.json", "utf8"));
const bySku = new Map();
for (const p of cin7) if (p.SKU) bySku.set(p.SKU.toUpperCase(), p);

const { rows } = await client.query(
  `SELECT cw.id cwid, cw."colorwaySku", cw.name cwname, cw.kind, cw.status, cw.source,
          cw."brandId", cw."styleId", cw."categoryId", cw."productType", cw.vendor,
          cw."countryOfOrigin", b.name brand,
          v.id vid, v."variantSku", v.barcode, v."sizeLabel"
     FROM "Colorway" cw
     JOIN "Brand" b ON b.id = cw."brandId"
     JOIN "Variant" v ON v."colorwayId" = cw.id
    WHERE b.name ILIKE '%vintage%'
      AND cw.id IN (SELECT "colorwayId" FROM "Variant" GROUP BY "colorwayId" HAVING count(*) > 1)
      AND cw."colorwaySku" <> ALL($1::text[])
    ORDER BY cw."colorwaySku", v."variantSku"`,
  [EXCEPTIONS]
);

const season = await client.query(`SELECT id FROM "Season" WHERE code = 'CONTINUITY'`);
const seasonId = season.rows[0]?.id;
if (!seasonId) throw new Error("No CONTINUITY season");

// Every SKU the master already holds, so a new colourway or style can never
// collide with one — the split mints a colourway SKU equal to the variant SKU,
// which is the established vintage shape (1,843 rows) and which Loom confirmed
// does not collide with its product namespace.
const taken = await client.query(
  `SELECT "colorwaySku" s FROM "Colorway" UNION ALL SELECT "styleSku" FROM "Style"`
);
const used = new Set(taken.rows.map((r) => r.s.toUpperCase()));

// Brand comes from Cin7, not from the old parent. The `EXT` colourway is a junk
// drawer — `splitSku("EXT-BPHC003")` yielded base "EXT" — so six Bon Parfumeur
// hand creams and soaps are currently filed under Vintage. Inheriting the old
// parent's brand would carry that error into the new rows.
const brands = await client.query(`SELECT id, name FROM "Brand"`);
const brandByName = new Map(brands.rows.map((b) => [b.name.trim().toLowerCase(), b.id]));
const unknownBrands = new Set();

const plan = [];
const collisions = [];
const missing = [];
const oldColorways = new Map();

for (const r of rows) {
  const p = bySku.get(r.variantSku.toUpperCase());
  if (!p) {
    missing.push(r.variantSku);
    continue;
  }
  const name = cleanName(p.Name);
  const sku = r.variantSku;
  const cin7Brand = (p.Brand ?? "").trim() || null;
  const resolvedBrandId =
    (cin7Brand && brandByName.get(cin7Brand.toLowerCase())) || r.brandId;
  if (cin7Brand && !brandByName.has(cin7Brand.toLowerCase())) unknownBrands.add(cin7Brand);
  // The old colourway keeps its row and is withdrawn, which is what stops its
  // style reaching zero colourways — a style has no withdrawal axis in Loom.
  oldColorways.set(r.cwid, { colorwaySku: r.colorwaySku, name: r.cwname, styleId: r.styleId });
  if (used.has(sku.toUpperCase()) && sku.toUpperCase() !== r.colorwaySku.toUpperCase()) {
    collisions.push(sku);
    continue;
  }
  plan.push({
    variantId: r.vid,
    variantSku: sku,
    barcode: r.barcode,
    wasSizeLabel: r.sizeLabel,
    fromColorwayId: r.cwid,
    fromColorwaySku: r.colorwaySku,
    newStyleSku: sku,
    newColorwaySku: sku,
    name,
    brandId: resolvedBrandId,
    brandName: cin7Brand ?? r.brand,
    brandChanged: resolvedBrandId !== r.brandId,
    kind: r.kind,
    status: r.status,
    source: r.source,
    categoryId: r.categoryId,
    productType: r.productType ?? p.Category ?? null,
    vendor: r.vendor,
    countryOfOrigin: r.countryOfOrigin ?? p.CountryOfOrigin ?? null,
    category: p.Category ?? "Uncategorized",
    priceNok: typeof p.PriceTiers?.Retail === "number" && p.PriceTiers.Retail > 0
      ? p.PriceTiers.Retail
      : null,
    seasonId,
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  seasonId,
  exceptions: EXCEPTIONS,
  counts: {
    variantsToSplit: plan.length,
    newStyles: plan.length,
    newColorways: plan.length,
    oldColorwaysToWithdraw: oldColorways.size,
    withPrice: plan.filter((p) => p.priceNok != null).length,
    withBarcode: plan.filter((p) => p.barcode).length,
    skuCollisions: collisions.length,
    missingFromCin7: missing.length,
    brandCorrected: plan.filter((p) => p.brandChanged).length,
  },
  unknownBrands: [...unknownBrands],
  oldColorways: [...oldColorways.entries()].map(([id, v]) => ({ colorwayId: id, ...v })),
  collisions,
  missing,
  plan,
};
writeFileSync("snapshots/vintage-split-plan.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.counts, null, 2));
console.log("\nold colourways to withdraw:");
for (const o of out.oldColorways) console.log(`  ${o.colorwaySku.padEnd(24)} "${o.name}"`);
if (out.unknownBrands.length)
  console.log("\nCin7 brands with no Brand row here (kept the old brand):", out.unknownBrands);
const corrected = plan.filter((p) => p.brandChanged);
if (corrected.length) {
  console.log(`\nbrand corrected from the old parent for ${corrected.length}:`);
  for (const p of corrected) console.log(`  ${p.newColorwaySku.padEnd(24)} -> ${p.brandName}`);
}
console.log("\nsample of the new products:");
for (const p of plan.slice(0, 8))
  console.log(`  ${p.newColorwaySku.padEnd(28)} "${p.name}"  (was size "${p.wasSizeLabel}" of ${p.fromColorwaySku})  ${p.priceNok ?? "no price"}`);
console.log("\nwritten -> snapshots/vintage-split-plan.json");
await client.end();
