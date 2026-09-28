// Read-only: which Loom variants lack a shopify_inventory_item_id although
// Shopify holds a live product for the same garment — and does Origio know it.
//
//   node scripts/shopify-inventory-ids/survey.mjs     writes survey.json here
//
// Joins, in order of trust: Loom variant_id = Origio Variant.id (then Origio's
// SHOPIFY ref gives the Shopify variant), else normalised SKU, else barcode.
import pg from "pg";
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: new URL("../../.env.local", import.meta.url).pathname, quiet: true });

const LOOM = "https://loom.livid.no/api/origio/v1";
const auth = { Authorization: `Bearer ${process.env.LOOM_LOCAL_TOKEN}` };
const store = process.env.SHOPIFY_STORE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/(^|-)(\d{2})\/(\d{2})($|-)/g, "$1$2$3$4");
const num = (gid) => (gid ? String(gid).split("/").pop() : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Loom — every row.
const loomRows = [];
let cursor = null;
do {
  const url = `${LOOM}/products?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`Loom ${res.status} ${await res.text()}`);
  const j = await res.json();
  loomRows.push(...j.rows);
  cursor = j.nextCursor;
  await sleep(300);
} while (cursor);
console.error(`loom: ${loomRows.length} colorways`);

// 2. Shopify — every variant with its InventoryItem and product status.
const Q = `query($after:String){ productVariants(first:250, after:$after){
  pageInfo{ hasNextPage endCursor }
  nodes{ id sku barcode inventoryItem{ id tracked } product{ id title status handle } } } }`;
const shopVariants = [];
let after = null;
for (;;) {
  const res = await fetch(`https://${store}/admin/api/2025-10/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: Q, variables: { after } }),
  });
  const j = await res.json();
  if (j.errors) {
    if (JSON.stringify(j.errors).includes("THROTTLED")) { await sleep(2000); continue; }
    throw new Error(JSON.stringify(j.errors));
  }
  const pv = j.data.productVariants;
  shopVariants.push(...pv.nodes);
  if (!pv.pageInfo.hasNextPage) break;
  after = pv.pageInfo.endCursor;
  const avail = j.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 1000;
  if (avail < 400) await sleep(1500);
}
console.error(`shopify: ${shopVariants.length} variants`);
const shopById = new Map(shopVariants.map((v) => [v.id, v]));
const shopBySku = new Map();
const shopByBarcode = new Map();
for (const v of shopVariants) {
  if (v.sku) (shopBySku.get(norm(v.sku)) ?? shopBySku.set(norm(v.sku), []).get(norm(v.sku))).push(v);
  if (v.barcode) (shopByBarcode.get(v.barcode.trim()) ?? shopByBarcode.set(v.barcode.trim(), []).get(v.barcode.trim())).push(v);
}

// 3. Origio — variants, their Shopify ref and their colourway.
const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED });
await c.connect();
let origio;
try {
  ({ rows: origio } = await c.query(`
    SELECT v.id, v."variantSku", v.barcode, cw.id AS "colorwayId", cw."colorwaySku", cw.archived,
           r."externalId" AS "shopVariantGid", r."externalInventoryId" AS "shopInvGid"
    FROM "Variant" v JOIN "Colorway" cw ON cw.id = v."colorwayId"
    LEFT JOIN "VariantChannelRef" r ON r."variantId" = v.id AND r.channel = 'SHOPIFY'`));
} finally {
  await c.end();
}
const origioById = new Map(origio.map((o) => [o.id, o]));
const origioBySku = new Map(origio.map((o) => [norm(o.variantSku), o]));

// 4. Classify every Loom variant without an inventory item id.
const t = { loomVariants: 0, withId: 0, withoutId: 0, byStatus: {}, byMatch: {}, origio: {} };
const missing = [];
const idDiffers = [];
for (const cw of loomRows)
  for (const lv of cw.variants ?? []) {
    t.loomVariants++;
    const o = origioById.get(lv.variant_id) ?? origioBySku.get(norm(lv.variant_sku));
    let match = null;
    let sv = null;
    if (o?.shopVariantGid && shopById.has(o.shopVariantGid)) {
      sv = shopById.get(o.shopVariantGid);
      match = "origio-ref";
    }
    if (!sv) {
      const bySku = (shopBySku.get(norm(lv.variant_sku)) ?? []).filter((v) => v.product.status !== "ARCHIVED");
      const anySku = shopBySku.get(norm(lv.variant_sku)) ?? [];
      const pick = bySku.length === 1 ? bySku[0] : bySku.length === 0 && anySku.length === 1 ? anySku[0] : null;
      if (pick) { sv = pick; match = "sku"; }
      else if (bySku.length > 1) match = "sku-ambiguous";
    }
    if (!sv && !match && lv.barcode) {
      const bc = shopByBarcode.get(String(lv.barcode).trim()) ?? [];
      if (bc.length === 1) { sv = bc[0]; match = "barcode"; }
      else if (bc.length > 1) match = "barcode-ambiguous";
    }
    const have = lv.shopify_inventory_item_id ? String(lv.shopify_inventory_item_id) : null;
    if (have) {
      t.withId++;
      if (sv && num(sv.inventoryItem?.id) !== num(have))
        idDiffers.push({ sku: lv.variant_sku, loom: have, shopify: num(sv.inventoryItem?.id), status: sv.product.status, match });
      continue;
    }
    t.withoutId++;
    const status = sv ? sv.product.status : match ?? "no-shopify";
    t.byStatus[status] = (t.byStatus[status] ?? 0) + 1;
    if (sv) t.byMatch[match] = (t.byMatch[match] ?? 0) + 1;
    const oState = !o ? "not-in-origio" : o.shopInvGid ? "origio-has-inv" : o.shopVariantGid ? "origio-ref-no-inv" : "origio-no-ref";
    if (sv) t.origio[`${status}/${oState}`] = (t.origio[`${status}/${oState}`] ?? 0) + 1;
    const stock = (lv.stock ?? []).reduce((a, s) => a + (Number(s.on_hand) || 0), 0);
    missing.push({
      loomColorwayId: cw.colorway_id,
      loomColorwaySku: cw.colorway_sku,
      loomArchived: cw.archived,
      seasons: (cw.seasons ?? []).map((s) => s.season), loomShopifyChannel: cw.channels?.shopify ?? null,
      variantId: lv.variant_id,
      sku: lv.variant_sku,
      barcode: lv.barcode,
      stock,
      origioVariantId: o?.id ?? null,
      origioColorwayId: o?.colorwayId ?? null,
      origioState: oState,
      origioInv: num(o?.shopInvGid),
      match,
      shopifyStatus: sv?.product.status ?? null,
      shopifyProduct: sv?.product.title ?? null,
      shopifyVariantGid: sv?.id ?? null,
      shopifyInventoryItemId: num(sv?.inventoryItem?.id),
      tracked: sv?.inventoryItem?.tracked ?? null,
    });
  }

console.log(JSON.stringify(t, null, 1));
console.log(`loom id differs from shopify: ${idDiffers.length}`, idDiffers.slice(0, 5));
const active = missing.filter((m) => m.shopifyStatus === "ACTIVE");
console.log(`ACTIVE in Shopify, id missing in Loom: ${active.length} variants in ${new Set(active.map((m) => m.loomColorwayId)).size} colourways`);
const byCw = new Map();
for (const m of active) byCw.set(m.loomColorwaySku, (byCw.get(m.loomColorwaySku) ?? 0) + 1);
console.log([...byCw].map(([k, n]) => `${k} ×${n}`).join("\n"));
writeFileSync(new URL("./survey.json", import.meta.url), JSON.stringify({ tally: t, idDiffers, missing }, null, 1));
