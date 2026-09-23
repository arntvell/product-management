// Plan the Red Wing care-product split. READ-ONLY: writes a plan file, nothing else.
//
// Same defect as the vintage collapse, one colourway wide. Cin7 puts the size
// last in a SKU, so the importer stripped the trailing segment and grouped on
// the rest. For the boots that is right — EXT-RW-8085-9.5 really is size 9.5 of
// the Iron Ranger. For the care products the trailing segment is not a size, it
// is the article: EXT-RW-97106 became *size "97106"* of a product named
// "Shoe Brush", and 13 other care articles were swallowed as sizes alongside it.
// The parent took its name and its 119 kr price from EXT-RW-97106, which is the
// actual Shoe Brush.
//
// SCOPE IS ONE COLOURWAY, DELIBERATELY. Every other EXT-RW-* colourway is a
// genuine US size run (8 – 11.5) and splitting one would destroy a correct
// product. The parent is named explicitly below and nothing globs EXT-RW-*.
//
// Emits the same plan shape as scripts/vintage-split/plan.mjs so the proven
// applier runs it:  node scripts/vintage-split/apply.mjs --plan=<this file>
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

// The app keeps its secrets in .env.local, which dotenv does not read by default.
config({ path: ".env.local" });

const PARENT_SKU = "EXT-RW";
// Pinned from the probe on 2026-09-22. Not used to find the row — used to refuse
// if the SKU now resolves to a different colourway than the one planned against.
const EXPECT_PARENT_ID = "b6a6f842-7a81-4743-a8dc-d806f6e06f95";
const OUT = "snapshots/rw-split-plan.json";

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
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
    WHERE cw."colorwaySku" = $1
    ORDER BY v."variantSku"`,
  [PARENT_SKU]
);
if (rows.length === 0) throw new Error(`No variants under ${PARENT_SKU}`);
const parentIds = new Set(rows.map((r) => r.cwid));
if (parentIds.size !== 1) throw new Error(`${PARENT_SKU} resolves to ${parentIds.size} colourways`);
const parentId = rows[0].cwid;
if (parentId !== EXPECT_PARENT_ID)
  throw new Error(`${PARENT_SKU} is now ${parentId}, planned against ${EXPECT_PARENT_ID}`);

const season = await client.query(`SELECT id FROM "Season" WHERE code = 'CONTINUITY'`);
const seasonId = season.rows[0]?.id;
if (!seasonId) throw new Error("No CONTINUITY season");

// Every SKU the master already holds, so a new colourway or style can never
// collide with one. The split mints a colourway SKU equal to the variant SKU —
// the established vintage shape, which Loom confirmed does not collide with its
// product namespace.
const taken = await client.query(
  `SELECT "colorwaySku" s FROM "Colorway" UNION ALL SELECT "styleSku" FROM "Style"`
);
const used = new Set(taken.rows.map((r) => r.s.toUpperCase()));

const brands = await client.query(`SELECT id, name FROM "Brand"`);
const brandByName = new Map(brands.rows.map((b) => [b.name.trim().toLowerCase(), b.id]));
const unknownBrands = new Set();

const plan = [];
const collisions = [];
const missing = [];
const oldColorways = new Map();

for (const r of rows) {
  const p = bySku.get(r.variantSku.toUpperCase());
  // The proof that a variant is its own product is that Cin7 carries it as its
  // own product, with its own name. Without that there is no name to split to,
  // so it stays put rather than being invented.
  if (!p) {
    missing.push(r.variantSku);
    continue;
  }
  const name = String(p.Name ?? "").replace(/\s{2,}/g, " ").trim();
  if (!name) {
    missing.push(r.variantSku);
    continue;
  }
  const sku = r.variantSku;
  const cin7Brand = (p.Brand ?? "").trim() || null;
  const resolvedBrandId = (cin7Brand && brandByName.get(cin7Brand.toLowerCase())) || r.brandId;
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
    // Brand is already Red Wing on the parent and in Cin7 — unlike vintage's EXT
    // junk drawer there is no brand to correct, so productType/vendor ("Care",
    // "Red Wing") describe these products correctly and are carried over.
    brandChanged: resolvedBrandId !== r.brandId,
    kind: r.kind,
    status: r.status,
    source: r.source,
    categoryId: r.categoryId,
    productType: r.productType ?? p.Category ?? null,
    vendor: r.vendor,
    countryOfOrigin: r.countryOfOrigin ?? p.CountryOfOrigin ?? null,
    category: p.Category ?? "Uncategorized",
    // Each article has its own retail price. The parent carries a single 119,
    // which is EXT-RW-97106's — right for the Shoe Brush, wrong for the other 13.
    priceNok:
      typeof p.PriceTiers?.Retail === "number" && p.PriceTiers.Retail > 0
        ? p.PriceTiers.Retail
        : null,
    seasonId,
  });
}

const barcodes = plan.map((p) => p.barcode).filter(Boolean);
const out = {
  generatedAt: new Date().toISOString(),
  parent: PARENT_SKU,
  seasonId,
  counts: {
    variantsToSplit: plan.length,
    newStyles: plan.length,
    newColorways: plan.length,
    oldColorwaysToWithdraw: oldColorways.size,
    withPrice: plan.filter((p) => p.priceNok != null).length,
    withBarcode: barcodes.length,
    distinctBarcodes: new Set(barcodes).size,
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
writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log(JSON.stringify(out.counts, null, 2));
if (out.counts.distinctBarcodes !== out.counts.withBarcode)
  console.log("\n!! barcodes are not distinct — these may not be separate articles");
if (collisions.length) console.log("\nSKU collisions:", collisions);
if (missing.length) console.log("\nnot in Cin7 (left under the parent):", missing);
if (out.unknownBrands.length)
  console.log("\nCin7 brands with no Brand row here (kept the old brand):", out.unknownBrands);

console.log(`\nwithdrawing: ${out.oldColorways.map((o) => `${o.colorwaySku} "${o.name}"`).join(", ")}`);
console.log("\nthe new products:");
for (const p of plan)
  console.log(
    `  ${p.newColorwaySku.padEnd(16)} "${p.name}"`.padEnd(62) +
      `(was size "${p.wasSizeLabel}")  ${p.priceNok ?? "no price"}`
  );
console.log(`\nwritten -> ${OUT}`);
await client.end();
