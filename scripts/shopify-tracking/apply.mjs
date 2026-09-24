// Turn on "Track quantity" for Shopify variants Origio pushed untracked.
//
// Until the push-shopify fix, productSet never sent `tracked`, so every product
// Origio CREATED in Shopify went out untracked (products that already existed
// kept theirs: productSet leaves an omitted field alone). An untracked item
// ignores the stock Pio, Loom and Sitoo sync onto it. Survey 2026-09-24: 29
// products / 83 variants, all created by Origio (28 on 2026-09-23, Almost Gray
// on 2026-07-14). Gift Wrap is untracked on purpose (kind SERVICE) and skipped.
//
// NOT a re-push: productSet is declarative and would rewrite title, tags,
// status and metafields too. This is productVariantsBulkUpdate with
// inventoryItem.tracked and nothing else.
//
// Scope: products Origio has a Shopify publication for with a push status (the
// ones a push could have made), colourway kind != SERVICE, variants whose LIVE
// state is untracked. Re-running is a no-op once they are tracked.
//
//   node scripts/shopify-tracking/apply.mjs                    dry run
//   node scripts/shopify-tracking/apply.mjs --only EXT-PNT-RS-CHCLT --apply
//   node scripts/shopify-tracking/apply.mjs --apply
import pg from "pg";
import fs from "fs";

const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, "m"))[1];
const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

const store = get("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "");
const token = get("SHOPIFY_ACCESS_TOKEN");
async function gql(query, variables) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://${store}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 429 && attempt < 5) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`Shopify ${r.status} ${r.statusText}`);
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  }
}

const c = new pg.Client({ connectionString: get("ORIGO_DATABASE_URL") });
await c.connect();
const pubs = (await c.query(
  `select cw."colorwaySku", cw.kind, cp."externalId"
     from "ChannelPublication" cp join "Colorway" cw on cw.id = cp."colorwayId"
    where cp.channel = 'SHOPIFY' and cp."externalId" is not null and cp."lastPushStatus" is not null
      and ($1::text is null or cw."colorwaySku" = $1)
    order by cw."colorwaySku"`,
  [ONLY],
)).rows;
await c.end();
if (ONLY && pubs.length === 0) throw new Error(`no Shopify publication for ${ONLY}`);

const PRODUCTS_QUERY = `query P($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title status
  variants(first: 250) { nodes { id sku inventoryItem { id tracked } } } } } }`;
async function readProducts(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const d = await gql(PRODUCTS_QUERY, { ids: ids.slice(i, i + 25) });
    for (const n of d.nodes) if (n) out.set(n.id, n);
  }
  return out;
}

const live = await readProducts(pubs.map((p) => p.externalId));
const plan = [];
let skippedService = 0, gone = 0;
for (const p of pubs) {
  const product = live.get(p.externalId);
  if (!product) { gone++; continue; }
  const untracked = product.variants.nodes.filter((v) => v.inventoryItem && !v.inventoryItem.tracked);
  if (!untracked.length) continue;
  if (p.kind === "SERVICE") { skippedService++; continue; }
  plan.push({ sku: p.colorwaySku, product, untracked });
}

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${pubs.length} Origio-pushed products scanned; ` +
  `${plan.length} to fix (${plan.reduce((n, p) => n + p.untracked.length, 0)} variants); ` +
  `${skippedService} SERVICE left untracked; ${gone} no longer in Shopify`);
for (const p of plan)
  console.log(`  ${p.sku} | ${p.product.title} | ${p.product.status} | ${p.untracked.length}/${p.product.variants.nodes.length} untracked`);
if (!APPLY) process.exit(0);

const MUTATION = `mutation T($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id inventoryItem { tracked } }
    userErrors { field message code } } }`;
const failures = [];
for (const p of plan) {
  try {
    const d = await gql(MUTATION, {
      productId: p.product.id,
      variants: p.untracked.map((v) => ({ id: v.id, inventoryItem: { tracked: true } })),
    });
    const errs = d.productVariantsBulkUpdate.userErrors;
    if (errs.length) throw new Error(errs.map((e) => `${e.code ?? ""} ${e.message}`).join("; "));
    console.log(`  wrote ${p.sku}: ${p.untracked.length} variant(s)`);
  } catch (err) {
    failures.push({ sku: p.sku, error: err.message });
    console.log(`  FAILED ${p.sku}: ${err.message}`);
    // A scope refusal will refuse every product the same way — stop at the first.
    if (/access|scope|denied/i.test(err.message)) break;
  }
}

// Read back from Shopify, not from the mutation's echo.
const after = await readProducts(plan.map((p) => p.product.id));
let nowTracked = 0, stillUntracked = 0;
for (const p of plan) {
  const vs = after.get(p.product.id)?.variants.nodes ?? [];
  for (const v of vs) if (p.untracked.some((u) => u.id === v.id)) v.inventoryItem?.tracked ? nowTracked++ : stillUntracked++;
}
console.log({ planned: plan.reduce((n, p) => n + p.untracked.length, 0), nowTracked, stillUntracked, failures });
