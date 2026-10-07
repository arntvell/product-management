// Read the M.O.P buttons back from Loom: identity for all 41 keys, then each
// colourway's season, sizes, Pio ref and stock.
//   node scripts/mop-buttons/verify.mjs
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const B = "https://loom.livid.no/api/origio/v1";
const H = { Authorization: `Bearer ${env.LOOM_LOCAL_TOKEN}`, "Content-Type": "application/json" };
const cols = ["511", "5120", "515", "516", "517"];
const sizes = ["L16", "L18", "L20", "L22", "L24", "L28", "L32"];
const cwSkus = cols.map((c) => `2526-1208-${c}`);
const vSkus = cwSkus.flatMap((c) => sizes.map((s) => `${c}-${s}`));

const id = await (await fetch(`${B}/identity`, { method: "POST", headers: H, body: JSON.stringify({ skus: [...cwSkus, ...vSkus] }) })).json();
const known = id.rows.filter((r) => r.colorway || r.variant).length;
console.log(`identity: ${known}/${id.rows.length} keys known to Loom`);

for (const sku of cwSkus) {
  const j = await (await fetch(`${B}/products?sku=${sku}`, { headers: H })).json();
  const r = j.rows?.[0];
  if (!r) { console.log(sku, "NOT IN LOOM"); continue; }
  const stock = r.variants.map((v) => `${v.variant_sku.split("-").pop()}:${v.stock?.map((s) => s.on_hand).join("+") || "-"}`);
  console.log(
    sku, `"${r.name}"`, `style ${r.style?.style_sku} "${r.style?.style_name}"`,
    `seasons ${r.seasons.map((s) => s.season).join(",")}`, `pio ${r.pio_product_ref ?? "null"}`,
    `sizes ${r.variants.length}`, stock.join(" ")
  );
}
