// Plan the Saphir re-nest. READ-ONLY: writes a plan file, nothing else.
//
// Same importer defect as vintage and the Red Wing care split: Cin7 puts the
// size last in a SKU, so the importer stripped the trailing segment and grouped
// on the rest. For Saphir the trailing segment is never a size. It is either
//
//   - the ARTICLE — EXT-ZP swallowed six unrelated products (a crepe brush, a
//     cotton cloth, Renovateur, a spreading brush, a waterproof spray, a stain
//     remover) as "sizes" CBR, CTN, RNV, SBWB, SIWS, WSM of a product named after
//     one of them; or
//   - the COLOUR — Crème 1925 in Black/Dark Brown/Light Brown/Medium Brown/
//     Neutral became five sizes of "Crème 1925 Light Brown".
//
// The two need different fixes. Articles get a style each (the Red Wing shape).
// Colours are one product in several colours, which in this model is ONE style
// with a colourway per colour — so those rows keep the parent's existing style
// (same id, so Loom updates it in place rather than gaining a shell) and it is
// renamed from the colour-specific name it inherited to the product name.
//
// Every parent is CIN7_IMPORT with no threadflowId, so no Threadflow sync will
// re-parent them back.
//
// Emits the vintage plan shape plus optional fields (styleName, renameStyle,
// color, fullDescription, tags, styleWeightKg, declareChannels) that
// scripts/vintage-split/apply.mjs reads when present:
//   node scripts/vintage-split/apply.mjs --plan=snapshots/saphir-split-plan.json
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Named and pinned explicitly — nothing globs EXT-ZP-*/EXT-SP-*. EXT-SP (Omni
// cleaner), EXT-SP-SPLO and EXT-SP-SPTBR hold one variant each and nest
// correctly, so they are out of scope.
const GROUPS = [
  {
    parent: "EXT-ZP",
    expectId: "a54e503d-d219-4540-a372-af336953abf7",
    shape: "articles",
    // The parent style is already named after the Spreading brush, so that
    // article keeps it — the other five get a style each, and no style is left
    // empty in Loom.
    keepStyleFor: "EXT-ZP-SBWB",
  },
  {
    parent: "EXT-ZP-1925",
    expectId: "4159ca48-976a-4239-81f7-5e3efc58fe2d",
    shape: "colours",
    styleName: "Crème 1925",
    colours: { BL: "Black", DB: "Dark Brown", LB: "Light Brown", MB: "Medium Brown", NT: "Neutral" },
  },
  {
    parent: "EXT-ZP-PB",
    expectId: "91007781-7d08-4c35-89f9-e1257048e591",
    shape: "colours",
    styleName: "Polishing brush",
    colours: { BK: "Black", WH: "White" },
  },
  {
    parent: "EXT-SP-PT1925",
    expectId: "78676ff9-d612-4ccd-9e9a-e8a436ccca53",
    shape: "colours",
    styleName: "Pate De Luxe",
    colours: { DB: "Dark Brown", MB: "Mid Brown", NT: "Neutral" },
  },
];
const OUT = "snapshots/saphir-split-plan.json";

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const cin7 = JSON.parse(readFileSync(process.argv[2] ?? "snapshots/cin7_products.json", "utf8"));
const bySku = new Map();
for (const p of cin7) if (p.SKU) bySku.set(p.SKU.toUpperCase(), p);

const season = await client.query(`SELECT id FROM "Season" WHERE code = 'CONTINUITY'`);
const seasonId = season.rows[0]?.id;
if (!seasonId) throw new Error("No CONTINUITY season");

// Every SKU the master already holds, per namespace, so a new colourway or
// style can never collide with an existing one.
const cwTaken = await client.query(`SELECT upper("colorwaySku") s FROM "Colorway"`);
const stTaken = await client.query(`SELECT upper("styleSku") s FROM "Style"`);
const usedCw = new Set(cwTaken.rows.map((r) => r.s));
const usedSt = new Set(stTaken.rows.map((r) => r.s));

const plan = [];
const collisions = [];
const missing = [];
const oldColorways = [];

for (const g of GROUPS) {
  const { rows } = await client.query(
    `SELECT cw.id cwid, cw."colorwaySku", cw.name cwname, cw.kind, cw.status, cw.source,
            cw."threadflowId" cwtf, cw."brandId", cw."styleId", cw."categoryId", cw."productType",
            cw.vendor, cw."countryOfOrigin", cw."fullDescription", cw.tags, b.name brand,
            s."styleSku", s."styleName", s."weightKg",
            v.id vid, v."variantSku", v.barcode, v."sizeLabel",
            ARRAY(SELECT DISTINCT r.channel::text FROM "VariantChannelRef" r
                   WHERE r."variantId" = v.id AND r.channel IN ('SHOPIFY','SITOO')
                   ORDER BY 1) channels
       FROM "Colorway" cw
       JOIN "Brand" b ON b.id = cw."brandId"
       JOIN "Style" s ON s.id = cw."styleId"
       JOIN "Variant" v ON v."colorwayId" = cw.id
      WHERE cw."colorwaySku" = $1
      ORDER BY v."variantSku"`,
    [g.parent]
  );
  if (rows.length === 0) throw new Error(`No variants under ${g.parent}`);
  const parentId = rows[0].cwid;
  if (parentId !== g.expectId) throw new Error(`${g.parent} is now ${parentId}, planned against ${g.expectId}`);
  if (rows[0].cwtf) throw new Error(`${g.parent} carries a threadflowId — the next sync would undo a move`);
  oldColorways.push({ colorwayId: parentId, colorwaySku: g.parent, name: rows[0].cwname, styleId: rows[0].styleId });

  for (const r of rows) {
    const p = bySku.get(r.variantSku.toUpperCase());
    const name = String(p?.Name ?? "").replace(/\s{2,}/g, " ").trim();
    if (!p || !name) {
      missing.push(r.variantSku);
      continue;
    }
    const sku = r.variantSku;
    const token = sku.slice(g.parent.length + 1);

    let style;
    if (g.shape === "colours") {
      const color = g.colours[token];
      if (!color) throw new Error(`${sku}: no colour mapped for token "${token}"`);
      // Guard against a mis-mapped colour: Cin7's own name must say it.
      if (!name.toLowerCase().includes(color.toLowerCase()))
        throw new Error(`${sku}: Cin7 name "${name}" does not contain colour "${color}"`);
      style = {
        newStyleSku: r.styleSku, // reuse the parent's style row
        styleName: g.styleName,
        renameStyle: true,
        color,
        // One product, one description — it is true of every colour.
        fullDescription: r.fullDescription,
        tags: r.tags ?? [],
      };
    } else {
      const keep = sku === g.keepStyleFor;
      style = {
        newStyleSku: keep ? r.styleSku : sku,
        styleName: keep ? r.styleName : name,
        renameStyle: false,
        color: null,
        // The parent's description is the Spreading brush's; true of that
        // article only.
        fullDescription: keep ? r.fullDescription : null,
        tags: r.tags ?? [],
      };
      if (!keep && usedSt.has(sku.toUpperCase())) {
        collisions.push(`${sku} (style)`);
        continue;
      }
    }
    // The new colourway SKU is the variant SKU; it must not already exist.
    if (usedCw.has(sku.toUpperCase())) {
      collisions.push(`${sku} (colourway)`);
      continue;
    }

    plan.push({
      variantId: r.vid,
      variantSku: sku,
      barcode: r.barcode,
      wasSizeLabel: r.sizeLabel,
      fromColorwayId: r.cwid,
      fromColorwaySku: r.colorwaySku,
      newColorwaySku: sku,
      name, // Cin7's full name, kept on the colourway: it is what Pio's picker shows
      ...style,
      // New styles inherit the parent style's weight so customs does not lose it.
      styleWeightKg: r.weightKg,
      brandId: r.brandId,
      brandName: r.brand,
      brandChanged: false,
      kind: r.kind,
      status: r.status,
      source: r.source,
      categoryId: r.categoryId,
      productType: r.productType ?? p.Category ?? null,
      vendor: r.vendor,
      countryOfOrigin: r.countryOfOrigin ?? p.CountryOfOrigin ?? null,
      category: p.Category ?? "Uncategorized",
      priceNok:
        typeof p.PriceTiers?.Retail === "number" && p.PriceTiers.Retail > 0 ? p.PriceTiers.Retail : null,
      seasonId,
      // The applier mints colourways; without a declaration the Loom payload
      // sends sitoo:false/shopify:false for products live in both. Declare the
      // channels this variant's own refs prove.
      declareChannels: r.channels,
    });
  }
}

const barcodes = plan.map((p) => p.barcode).filter(Boolean);
const out = {
  generatedAt: new Date().toISOString(),
  parents: GROUPS.map((g) => g.parent),
  seasonId,
  counts: {
    variantsToMove: plan.length,
    newColorways: plan.length,
    newStyles: plan.filter((p) => p.newStyleSku === p.variantSku).length,
    stylesReused: new Set(plan.filter((p) => p.newStyleSku !== p.variantSku).map((p) => p.newStyleSku)).size,
    stylesRenamed: new Set(plan.filter((p) => p.renameStyle).map((p) => p.newStyleSku)).size,
    oldColorwaysToWithdraw: oldColorways.length,
    withPrice: plan.filter((p) => p.priceNok != null).length,
    withBarcode: barcodes.length,
    distinctBarcodes: new Set(barcodes).size,
    channelDeclarations: plan.reduce((n, p) => n + p.declareChannels.length, 0),
    skuCollisions: collisions.length,
    missingFromCin7: missing.length,
  },
  oldColorways,
  collisions,
  missing,
  plan,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log(JSON.stringify(out.counts, null, 2));
if (out.counts.distinctBarcodes !== out.counts.withBarcode) console.log("\n!! barcodes are not distinct");
if (collisions.length) console.log("\nSKU collisions:", collisions);
if (missing.length) console.log("\nnot in Cin7 (left under the parent):", missing);
for (const o of oldColorways) {
  console.log(`\n${o.colorwaySku} "${o.name}" -> withdrawn`);
  for (const p of plan.filter((x) => x.fromColorwaySku === o.colorwaySku))
    console.log(
      `  style ${p.newStyleSku.padEnd(34)} "${p.styleName}"${p.renameStyle ? " (renamed)" : ""}`.padEnd(78) +
        `| ${p.newColorwaySku.padEnd(18)} "${p.name}"${p.color ? ` colour ${p.color}` : ""}  ` +
        `${p.priceNok ?? "no price"} kr  [${p.declareChannels.join(",")}]`
    );
}
console.log(`\nwritten -> ${OUT}`);
await client.end();
