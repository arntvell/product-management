// Run from the directory holding the scan output. Writes candidates.json: Loom variants with no cost that match a Cin7 SKU or barcode with a cost above 0.
import fs from "node:fs";
const loom = JSON.parse(fs.readFileSync("loom-products.json"));
const cin7 = JSON.parse(fs.readFileSync("cin7-products.json"));
const bySku = new Map(), byBc = new Map(), bcDup = new Set();
for (const p of cin7) {
  if (p.SKU) bySku.set(p.SKU.trim().toUpperCase(), p);
  const b = p.Barcode?.trim();
  if (b) { if (byBc.has(b)) bcDup.add(b); byBc.set(b, p); }
}
const cin7WithCost = cin7.filter(p => p.AverageCost > 0).length;
let variants = 0, withCost = 0, noCost = 0, archivedNoCost = 0;
const hits = [], noMatch = [], matchedZero = [], conflicts = [];
const brandCount = {};
for (const cw of loom) for (const v of cw.variants) {
  variants++;
  if (v.average_cost > 0) { withCost++; continue; }
  noCost++; if (cw.archived) archivedNoCost++;
  const s = v.variant_sku?.trim().toUpperCase();
  const bySkuHit = s && bySku.get(s);
  const bc = v.barcode?.trim();
  const byBcHit = bc && !bcDup.has(bc) && byBc.get(bc);
  const hit = bySkuHit || byBcHit;
  if (bySkuHit && byBcHit && bySkuHit.ID !== byBcHit.ID) conflicts.push({ sku: v.variant_sku, bc, skuMatch: bySkuHit.SKU, bcMatch: byBcHit.SKU });
  if (!hit) { noMatch.push({ sku: v.variant_sku, brand: cw.brand, archived: cw.archived }); continue; }
  if (!(hit.AverageCost > 0)) { matchedZero.push(v.variant_sku); continue; }
  const stock = (v.stock||[]).reduce((a, x) => a + (x.on_hand||0), 0);
  hits.push({ loom_variant_id: v.loom_variant_id, variant_sku: v.variant_sku, barcode: bc, brand: cw.brand, archived: cw.archived,
    matchedBy: bySkuHit ? "sku" : "barcode", cin7_sku: hit.SKU, cin7_avg_cost: hit.AverageCost, loom_on_hand: stock });
  brandCount[cw.brand] = (brandCount[cw.brand]||0)+1;
}
fs.writeFileSync("candidates.json", JSON.stringify(hits, null, 1));
const onHand = hits.filter(h => h.loom_on_hand > 0).length;
console.log({ loomColorways: loom.length, variants, withCost, noCost, archivedNoCost,
  cin7Products: cin7.length, cin7WithCost, candidates: hits.length, candidatesWithStock: onHand,
  matchedByBarcodeOnly: hits.filter(h=>h.matchedBy==="barcode").length,
  matchedButCin7Zero: matchedZero.length, noCin7Match: noMatch.length, skuVsBarcodeConflicts: conflicts.length });
console.log("top brands", Object.entries(brandCount).sort((a,b)=>b[1]-a[1]).slice(0,15));
const nmB = {}; for (const n of noMatch) nmB[n.brand]=(nmB[n.brand]||0)+1;
console.log("no-match brands", Object.entries(nmB).sort((a,b)=>b[1]-a[1]).slice(0,10));
console.log("conflict sample", conflicts.slice(0,5));
