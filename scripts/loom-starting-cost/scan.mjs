// READ-ONLY. Run with builder .env.local sourced; writes loom-products.json and cin7-products.json next to itself.
// READ-ONLY: pull Loom products and Cin7 products, match on SKU/barcode.
import fs from "node:fs";
const OUT = new URL(".", import.meta.url).pathname;
const L = "https://loom.livid.no/api/origio/v1";
const lh = { Authorization: `Bearer ${process.env.LOOM_LOCAL_TOKEN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loomAll() {
  const rows = []; let cursor = null;
  do {
    const u = `${L}/products?limit=500${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await fetch(u, { headers: lh });
    if (r.status === 429) { await sleep(5000); continue; }
    const j = await r.json();
    if (!j.ok) throw new Error(JSON.stringify(j).slice(0, 300));
    rows.push(...j.rows); cursor = j.nextCursor;
    process.stderr.write(`loom ${rows.length}\r`);
    await sleep(300);
  } while (cursor);
  return rows;
}
async function cin7All() {
  const h = { "api-auth-accountid": process.env.CIN7_ACCOUNT_ID, "api-auth-applicationkey": process.env.CIN7_API_KEY };
  const all = []; let page = 1, total = Infinity;
  while (all.length < total) {
    const r = await fetch(`https://inventory.dearsystems.com/ExternalApi/v2/product?Page=${page}&Limit=1000`, { headers: h });
    if (r.status === 429) { await sleep(3000); continue; }
    if (!r.ok) throw new Error(`cin7 ${r.status} ${(await r.text()).slice(0,200)}`);
    const j = await r.json(); total = j.Total; all.push(...(j.Products ?? []));
    process.stderr.write(`cin7 ${all.length}/${total}\r`);
    if (!j.Products?.length) break; page++; await sleep(1200);
  }
  return all;
}
const [loom, cin7] = await Promise.all([loomAll(), cin7All()]);
fs.writeFileSync(OUT + "loom-products.json", JSON.stringify(loom));
fs.writeFileSync(OUT + "cin7-products.json", JSON.stringify(cin7));
console.log("\nloom colorways", loom.length, "cin7 products", cin7.length);
