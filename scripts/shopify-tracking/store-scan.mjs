// Read-only: every Shopify product created since 2026-06-01 with an untracked variant.
import fs from "fs";
const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=["']?([^"'\\n]+)`, "m"))[1];
const store = get("SHOPIFY_STORE_URL").replace(/^https?:\/\//, ""), token = get("SHOPIFY_ACCESS_TOKEN");
const gql = async (query, variables) => { for (;;) { const r = await fetch(`https://${store}/admin/api/2025-10/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }) }); if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500)); continue; } const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data; } };
let after = null, n = 0; const hits = [];
do {
  const d = await gql(`query($a:String){ products(first:100, after:$a, query:"status:active OR status:draft OR status:archived"){ nodes { id title status createdAt vendor variants(first:100){ nodes { sku inventoryItem { tracked } } } } pageInfo { hasNextPage endCursor } } }`, { a: after });
  for (const p of d.products.nodes) { n++; const un = p.variants.nodes.filter((v) => !v.inventoryItem?.tracked); if (un.length) hits.push(`${p.createdAt.slice(0,10)} | ${p.status} | ${p.vendor} | ${p.title} | ${un.length}/${p.variants.nodes.length} | ${p.id.split("/").pop()}`); }
  after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
} while (after);
console.log("all products:", n); hits.forEach((h) => console.log(h)); console.log("untracked products:", hits.length);
