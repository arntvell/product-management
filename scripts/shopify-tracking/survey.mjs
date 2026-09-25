// Read-only: which Shopify products did Origio push, and are their variants tracked?
import pg from "pg";
import fs from "fs";
const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, "m"))[1];
const c = new pg.Client({ connectionString: get("ORIGO_DATABASE_URL") });
await c.connect();
const store = get("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "");
const token = get("SHOPIFY_ACCESS_TOKEN");
async function gql(query, variables) {
  for (;;) {
    const r = await fetch(`https://${store}/admin/api/2025-10/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }) });
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500)); continue; }
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  }
}
const pubs = (await c.query(`
  select cp."colorwayId", cp."externalId", cp."lastPushedAt", cp."lastPushStatus", cw."colorwaySku", cw.name
  from "ChannelPublication" cp join "Colorway" cw on cw.id = cp."colorwayId"
  where cp.channel='SHOPIFY' and cp."lastPushStatus" is not null and cp."externalId" is not null
  order by cp."lastPushedAt" desc`)).rows;
console.log("Origio-pushed Shopify publications:", pubs.length);
const Q = `query P($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id title status createdAt
  variants(first:100){ nodes { id sku inventoryPolicy inventoryQuantity inventoryItem { id tracked
    inventoryLevels(first:10){ nodes { location { id } } } } } } } } }`;
const out = [];
for (let i = 0; i < pubs.length; i += 25) {
  const chunk = pubs.slice(i, i + 25);
  const d = await gql(Q, { ids: chunk.map((p) => p.externalId) });
  d.nodes.forEach((n, k) => out.push({ pub: chunk[k], product: n }));
}
let vt = 0, vu = 0; const rows = [];
for (const { pub, product } of out) {
  if (!product) { rows.push({ sku: pub.colorwaySku, missing: true }); continue; }
  const vs = product.variants.nodes;
  const un = vs.filter((v) => !v.inventoryItem?.tracked);
  vt += vs.length - un.length; vu += un.length;
  rows.push({ sku: pub.colorwaySku, title: product.title, status: product.status, created: product.createdAt.slice(0,10),
    pushed: pub.lastPushedAt?.toISOString().slice(0,10), variants: vs.length, untracked: un.length,
    locs: [...new Set(vs.flatMap((v) => v.inventoryItem?.inventoryLevels.nodes.map((l) => l.location.id.split("/").pop()) ?? []))].join(","),
    policy: [...new Set(vs.map((v) => v.inventoryPolicy))].join(",") });
}
console.table(rows);
console.log({ products: out.length, variantsTracked: vt, variantsUntracked: vu });
fs.writeFileSync(new URL("./survey.json", import.meta.url), JSON.stringify(out, null, 1));
await c.end();
