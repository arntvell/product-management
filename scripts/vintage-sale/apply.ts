// Put vintage garments on sale on Shopify: lower the price, keep the old one as
// compareAtPrice (shown crossed out), tag vintage_sale. Online only — Sitoo is
// not touched, and Origo keeps the full price: the vintage push keeps a live
// markdown (push-shopify.ts), so a push during the sale does not end it.
//
// Input: a CSV with columns handle_guess (or handle), sku, current_price_nok and
// sale_price_nok — the sale sheet as exported. A row is refused, not guessed,
// when Shopify's price is not the sheet's current price.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/vintage-sale/apply.ts <file.csv>
//       dry run: what would change, nothing written
//   … apply.ts <file.csv> --apply
//
// Re-runnable: a garment already at its sale price, marked down and tagged is
// skipped. Writes scripts/vintage-sale/report-apply-<dry|apply>.json.
// End the sale with restore.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shopifyGraphQL } from "../../src/lib/shopify/client";
import { parseCsv, SALE_TAG } from "./shared";

const apply = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));

interface Product {
  id: string;
  handle: string;
  status: string;
  tags: string[];
  totalInventory: number;
  variants: { nodes: { id: string; sku: string | null; price: string; compareAtPrice: string | null }[] };
}

async function main() {
  if (!file) throw new Error("Pass the sale CSV");
  const rows = parseCsv(readFileSync(file, "utf8")).map((r) => ({
    handle: (r.handle ?? r.handle_guess ?? "").trim(),
    sku: (r.sku ?? "").trim(),
    current: Number(r.current_price_nok),
    sale: Number(r.sale_price_nok),
  }));
  console.log(`${rows.length} row(s); ${apply ? "APPLYING" : "dry run"}`);

  const byHandle = new Map<string, Product>();
  for (let i = 0; i < rows.length; i += 40) {
    const q = rows.slice(i, i + 40).map((r) => `handle:${r.handle}`).join(" OR ");
    const d = await shopifyGraphQL<{ products: { nodes: Product[] } }>(
      `query($q: String!) { products(first: 50, query: $q) { nodes {
         id handle status tags totalInventory
         variants(first: 5) { nodes { id sku price compareAtPrice } } } } }`,
      { q }
    );
    for (const p of d.products.nodes) byHandle.set(p.handle, p);
  }

  const report: { handle: string; sku: string; outcome: string; price?: string; compareAt?: string; note?: string }[] = [];
  for (const r of rows) {
    const p = byHandle.get(r.handle);
    const out = (outcome: string, extra: Partial<(typeof report)[number]> = {}) =>
      report.push({ handle: r.handle, sku: r.sku, outcome, ...extra });
    if (!p) { out("refused", { note: "no Shopify product with this handle" }); continue; }
    if (p.variants.nodes.length !== 1) { out("refused", { note: `${p.variants.nodes.length} variants; vintage has one` }); continue; }
    const v = p.variants.nodes[0];
    if (r.sku && v.sku?.toUpperCase() !== r.sku.toUpperCase()) { out("refused", { note: `Shopify SKU is ${v.sku}` }); continue; }
    if (!(r.sale > 0)) { out("refused", { note: "no sale price" }); continue; }
    const tagged = p.tags.includes(SALE_TAG);
    const markedDown = Number(v.compareAtPrice) > Number(v.price);
    if (markedDown && Number(v.price) === r.sale && tagged) { out("already on sale", { price: v.price, compareAt: v.compareAtPrice ?? undefined }); continue; }
    if (markedDown) { out("refused", { note: `already marked down: ${v.price} (was ${v.compareAtPrice})` }); continue; }
    if (Number(v.price) !== r.current) { out("refused", { note: `Shopify price ${v.price}, sheet says ${r.current}` }); continue; }
    if (r.sale >= Number(v.price)) { out("refused", { note: `sale price ${r.sale} is not below ${v.price}` }); continue; }
    const extra = { price: String(r.sale), compareAt: v.price, note: [p.status !== "ACTIVE" && `status ${p.status}`, p.totalInventory <= 0 && "no stock"].filter(Boolean).join(", ") || undefined };
    if (!apply) { out("would mark down", extra); continue; }
    const upd = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
      `mutation($id: ID!, $v: [ProductVariantsBulkInput!]!) {
         productVariantsBulkUpdate(productId: $id, variants: $v) { userErrors { message } } }`,
      { id: p.id, v: [{ id: v.id, price: String(r.sale), compareAtPrice: v.price }] }
    );
    const tag = tagged
      ? { tagsAdd: { userErrors: [] as { message: string }[] } }
      : await shopifyGraphQL<{ tagsAdd: { userErrors: { message: string }[] } }>(
          `mutation($id: ID!, $t: [String!]!) { tagsAdd(id: $id, tags: $t) { userErrors { message } } }`,
          { id: p.id, t: [SALE_TAG] }
        );
    const errs = [...upd.productVariantsBulkUpdate.userErrors, ...tag.tagsAdd.userErrors].map((e) => e.message);
    out(errs.length ? "failed" : "marked down", errs.length ? { note: errs.join("; ") } : extra);
  }

  const tally = report.reduce<Record<string, number>>((t, r) => ((t[r.outcome] = (t[r.outcome] ?? 0) + 1), t), {});
  console.log(tally);
  for (const r of report.filter((x) => x.outcome === "refused" || x.outcome === "failed" || x.note))
    console.log(`  ${r.outcome}: ${r.handle} — ${r.note}`);
  writeFileSync(join(__dirname, `report-apply-${apply ? "apply" : "dry"}.json`), JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
