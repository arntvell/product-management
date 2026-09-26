// Turns candidates.json (from match.mjs) into the files Loom imports.
// Livid and Vintage go in one import file (Kristoffer, 2026-09-26).
// External brands are never written: their average cost is built in Loom from
// PO receipts (Kristoffer, 2026-09-26).
import fs from "node:fs";
const dir = process.argv[2] ?? ".";
const loom = JSON.parse(fs.readFileSync(`${dir}/loom-products.json`));
const c = JSON.parse(fs.readFileSync(`${dir}/candidates.json`));
const stable = new Map();
for (const cw of loom) for (const v of cw.variants) stable.set(v.loom_variant_id, v.variant_id);
const q = (s) => (s == null ? "" : /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
const head = ["loom_variant_id", "variant_id", "variant_sku", "barcode", "starting_average_cost", "currency",
  "source", "source_ref", "loom_on_hand_at_export", "exported_at"];
const at = new Date().toISOString();
function write(name, rows) {
  const lines = [head, ...rows.sort((a, b) => a.variant_sku.localeCompare(b.variant_sku)).map((h) => [
    h.loom_variant_id, stable.get(h.loom_variant_id) ?? "", h.variant_sku, h.barcode ?? "",
    h.cin7_avg_cost.toFixed(2), "NOK", "cin7_average_cost", h.cin7_sku, h.loom_on_hand, at])];
  fs.writeFileSync(`${dir}/${name}`, lines.map((r) => r.map(q).join(",")).join("\n") + "\n");
  console.log(name, rows.length);
}
write("loom-starting-cost.csv", c.filter((h) => h.brand === "Livid" || h.brand === "Vintage"));
console.log("externals withheld", c.filter((h) => h.brand !== "Livid" && h.brand !== "Vintage").length);
