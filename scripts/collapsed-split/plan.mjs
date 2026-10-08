// Plan the 2026-10-08 split of ten collapsed colourways. READ-ONLY: writes a
// plan file, nothing else.
//
// Same importer defect as vintage, Red Wing and Saphir (docs/saphir-split.md):
// cin7/import.ts reads a SKU's trailing segment as a size and groups on the
// rest. These ten survived those passes because they were found from the other
// side — each "size" here is its OWN product in Shopify and/or Sitoo (41
// Shopify products, 52 sizes in all), so the master could neither find nor edit
// most of them. EXT-PF-RDFS-TKWTBC (Teakwood and Tobacco Reed Diffuser) was the
// report that surfaced it.
//
// Input: snapshots/collapsed-split-survey.json — every variant under the ten
// parents with its Shopify product (title, price, status) and Sitoo product.
// Names and prices come from Shopify where the item is there, else Sitoo.
//
// Structure follows each brand's own convention rather than one rule:
//   - one style per product (Bon Parfumeur, Frama, Steamery, Kinto, Chimi): the
//     parent's style row stays with the item it is already named after; every
//     other item gets a style whose SKU is its variant SKU;
//   - P.F. Candle styles are SCENTS ("Amber and Moss" holds four articles), so
//     its items join the scent's existing style;
//   - Paraboot's parent style is already the generic "Laces Michael", so the
//     three colours become colourways under it.
//
// Emits the plan shape scripts/vintage-split/apply.mjs reads:
//   node scripts/vintage-split/apply.mjs --plan=snapshots/collapsed-split-plan.json
// plus `shopifyProductGid` per row, which link.ts uses afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const GROUPS = {
  "EXT-BP": { keepStyleFor: "EXT-BP-BP301EDP30" },
  "EXT-FRM": { keepStyleFor: "EXT-FRM-11020" },
  "EXT-STM": { keepStyleFor: "EXT-STM-935" },
  "EXT-KNT-TBL-350": { keepStyleFor: "EXT-KNT-TBL-350-WH" },
  "EXT-KNT-WB-500": { keepStyleFor: "EXT-KNT-WB-500-AMB" },
  CHIMI: { keepStyleFor: "CHIMI-AviatorGeenP" },
  // The parent style carries the Cin7 size junk (" OS"); corrected as kept.
  "EXT-STM-CRS": { keepStyleFor: "EXT-STM-CRS-SND", renameKept: "Cirrus No.3 Iron Steamer - Sand" },
  "EXT-PR-LCT-X10-MC": {
    colours: { MR: "Marron", CF: "Café", NR: "Noir" },
  },
  "EXT-PF-11": { scentStyle: { all: "EXT-PF-AMBRMS" } },
  "EXT-PF-RDFS": { scentStyle: { "EXT-PF-RDFS-AMBRMS": "EXT-PF-AMBRMS", "EXT-PF-RDFS-TKWTBC": "EXT-PF-04" } },
};
const OUT = "snapshots/collapsed-split-plan.json";

const survey = JSON.parse(readFileSync("snapshots/collapsed-split-survey.json", "utf8"));

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const season = await client.query(`SELECT id FROM "Season" WHERE code = 'CONTINUITY'`);
const seasonId = season.rows[0]?.id;
if (!seasonId) throw new Error("No CONTINUITY season");

const usedCw = new Set((await client.query(`SELECT upper("colorwaySku") s FROM "Colorway"`)).rows.map((r) => r.s));
const usedSt = new Set((await client.query(`SELECT upper("styleSku") s FROM "Style"`)).rows.map((r) => r.s));

const plan = [];
const collisions = [];
const missing = [];
const oldColorways = [];
const priceConflicts = [];

for (const [parent, g] of Object.entries(GROUPS)) {
  const { rows } = await client.query(
    `SELECT cw.id cwid, cw."colorwaySku", cw.name cwname, cw.kind, cw.status, cw.source,
            cw."threadflowId" cwtf, cw."brandId", cw."styleId", cw."categoryId", cw."productType",
            cw.vendor, cw."countryOfOrigin", cw.tags, b.name brand,
            s."styleSku", s."styleName", s."weightKg", s.category,
            v.id vid, v."variantSku", v.barcode, v."sizeLabel",
            ARRAY(SELECT DISTINCT r.channel::text FROM "VariantChannelRef" r
                   WHERE r."variantId" = v.id AND r.channel IN ('SHOPIFY','SITOO') ORDER BY 1) channels,
            EXISTS(SELECT 1 FROM "ChannelPublication" p WHERE p."colorwayId" = cw.id AND p.channel = 'LOOM') onloom
       FROM "Colorway" cw
       JOIN "Brand" b ON b.id = cw."brandId"
       JOIN "Style" s ON s.id = cw."styleId"
       JOIN "Variant" v ON v."colorwayId" = cw.id
      WHERE cw."colorwaySku" = $1
      ORDER BY v."variantSku"`,
    [parent]
  );
  if (!rows.length) throw new Error(`No variants under ${parent}`);
  if (rows[0].cwtf) throw new Error(`${parent} carries a threadflowId — a sync would undo the move`);
  oldColorways.push({ colorwayId: rows[0].cwid, colorwaySku: parent, name: rows[0].cwname, styleId: rows[0].styleId });

  for (const r of rows) {
    const s = survey.find((x) => x.variantId === r.vid);
    const name = String(s?.shopTitle ?? s?.sitooTitle ?? "").replace(/\s{2,}/g, " ").trim();
    if (!s || !name) {
      missing.push(r.variantSku);
      continue;
    }
    const sku = r.variantSku;
    const shopPrice = s.shopPrice != null ? Number(s.shopPrice) : null;
    const sitooPrice = s.sitooPrice != null ? Number(s.sitooPrice) : null;
    if (shopPrice != null && sitooPrice != null && shopPrice !== sitooPrice)
      priceConflicts.push(`${sku}: Shopify ${shopPrice} / Sitoo ${sitooPrice} — master takes Shopify`);

    let style;
    if (g.colours) {
      const token = sku.slice(parent.length + 1);
      const color = g.colours[token];
      if (!color) throw new Error(`${sku}: no colour mapped for "${token}"`);
      if (!name.toLowerCase().includes(color.toLowerCase()))
        throw new Error(`${sku}: "${name}" does not contain colour "${color}"`);
      style = { newStyleSku: r.styleSku, styleName: r.styleName, renameStyle: false, color };
    } else if (g.scentStyle) {
      const target = g.scentStyle.all ?? g.scentStyle[sku];
      if (!target) throw new Error(`${sku}: no scent style mapped`);
      const st = await client.query(`SELECT "styleSku", "styleName" FROM "Style" WHERE "styleSku" = $1`, [target]);
      if (!st.rowCount) throw new Error(`${sku}: scent style ${target} does not exist`);
      style = { newStyleSku: target, styleName: st.rows[0].styleName, renameStyle: false, color: null };
    } else {
      const keep = sku === g.keepStyleFor;
      if (!keep && usedSt.has(sku.toUpperCase())) {
        collisions.push(`${sku} (style)`);
        continue;
      }
      style = keep
        ? { newStyleSku: r.styleSku, styleName: g.renameKept ?? r.styleName, renameStyle: !!g.renameKept, color: null }
        : { newStyleSku: sku, styleName: name, renameStyle: false, color: null };
    }
    if (usedCw.has(sku.toUpperCase())) {
      collisions.push(`${sku} (colourway)`);
      continue;
    }

    const declare = [...r.channels];
    if (r.onloom) declare.push("LOOM");
    const shopStatus = s.shopStatus; // ACTIVE | DRAFT | ARCHIVED, the shop's own

    plan.push({
      variantId: r.vid,
      variantSku: sku,
      barcode: r.barcode,
      wasSizeLabel: r.sizeLabel,
      fromColorwayId: r.cwid,
      fromColorwaySku: r.colorwaySku,
      newColorwaySku: sku,
      name,
      ...style,
      styleWeightKg: r.weightKg,
      brandId: r.brandId,
      brandName: r.brand,
      brandChanged: false,
      kind: r.kind,
      status: shopStatus ?? r.status,
      source: r.source,
      categoryId: r.categoryId,
      productType: r.productType,
      vendor: r.vendor,
      countryOfOrigin: r.countryOfOrigin,
      category: r.category ?? "Uncategorized",
      // Descriptions are NOT carried: the parent's was one item's. Refresh from
      // Shopify fills each from its own product after linking.
      fullDescription: null,
      tags: r.tags ?? [],
      priceNok: shopPrice ?? sitooPrice,
      seasonId,
      declareChannels: declare,
      shopifyProductGid: s.shopProduct ?? null,
    });
  }
}

await client.end();

const out = {
  generatedAt: new Date().toISOString(),
  parents: Object.keys(GROUPS),
  seasonId,
  counts: {
    variantsToMove: plan.length,
    newColorways: plan.length,
    newStyles: plan.filter((p) => p.newStyleSku === p.variantSku).length,
    stylesReused: new Set(plan.filter((p) => p.newStyleSku !== p.variantSku).map((p) => p.newStyleSku)).size,
    linkedToShopify: plan.filter((p) => p.shopifyProductGid).length,
    withPrice: plan.filter((p) => p.priceNok != null).length,
    skuCollisions: collisions.length,
    missing: missing.length,
    priceConflicts: priceConflicts.length,
  },
  oldColorways,
  collisions,
  missing,
  priceConflicts,
  plan,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));

console.log(JSON.stringify(out.counts, null, 2));
if (collisions.length) console.log("\nSKU collisions:", collisions);
if (missing.length) console.log("\nno name found (left under the parent):", missing);
if (priceConflicts.length) console.log("\nprice differs between channels:\n  " + priceConflicts.join("\n  "));
for (const o of oldColorways) {
  console.log(`\n${o.colorwaySku} "${o.name}" -> archived`);
  for (const p of plan.filter((x) => x.fromColorwaySku === o.colorwaySku))
    console.log(
      `  style ${p.newStyleSku.padEnd(30)} "${p.styleName}"${p.renameStyle ? " (renamed)" : ""}`.padEnd(80) +
        `| ${p.newColorwaySku.padEnd(26)} "${p.name}"${p.color ? ` colour ${p.color}` : ""} ` +
        `${p.priceNok ?? "no price"} kr ${p.status} [${p.declareChannels.join(",")}]`
    );
}
