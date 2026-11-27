// End a vintage sale on Shopify: every product tagged vintage_sale goes back to
// its compareAtPrice, the compare-at is cleared and the tag removed. Works from
// Shopify alone, so it needs no record of what apply.ts did.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/vintage-sale/restore.ts
//       dry run: what would change, nothing written
//   … restore.ts --apply
//   … restore.ts --only <handle> [--apply]
//
// A tagged product with no markdown just loses the tag. Re-runnable.
// Writes scripts/vintage-sale/report-restore-<dry|apply>.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { shopifyGraphQL } from "../../src/lib/shopify/client";
import { SALE_TAG } from "./shared";

const apply = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

interface Product {
  id: string;
  handle: string;
  variants: { nodes: { id: string; sku: string | null; price: string; compareAtPrice: string | null }[] };
}

async function main() {
  const products: Product[] = [];
  let after: string | null = null;
  do {
    const r: { products: { nodes: Product[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await shopifyGraphQL(
      `query($q: String!, $after: String) { products(first: 100, after: $after, query: $q) {
         nodes { id handle variants(first: 5) { nodes { id sku price compareAtPrice } } }
         pageInfo { hasNextPage endCursor } } }`,
      { q: `tag:${SALE_TAG}${only ? ` handle:${only}` : ""}`, after }
    );
    products.push(...r.products.nodes);
    after = r.products.pageInfo.hasNextPage ? r.products.pageInfo.endCursor : null;
  } while (after);
  console.log(`${products.length} product(s) tagged ${SALE_TAG}; ${apply ? "APPLYING" : "dry run"}`);

  const report: { handle: string; outcome: string; price?: string; note?: string }[] = [];
  for (const p of products) {
    const back = p.variants.nodes
      .filter((v) => Number(v.compareAtPrice) > Number(v.price))
      .map((v) => ({ id: v.id, price: v.compareAtPrice!, compareAtPrice: null }));
    const price = back.map((b) => b.price).join("/") || undefined;
    if (!apply) { report.push({ handle: p.handle, outcome: back.length ? "would restore" : "would untag", price }); continue; }
    const errs: string[] = [];
    if (back.length) {
      const upd = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
        `mutation($id: ID!, $v: [ProductVariantsBulkInput!]!) {
           productVariantsBulkUpdate(productId: $id, variants: $v) { userErrors { message } } }`,
        { id: p.id, v: back }
      );
      errs.push(...upd.productVariantsBulkUpdate.userErrors.map((e) => e.message));
    }
    if (!errs.length) {
      const rem = await shopifyGraphQL<{ tagsRemove: { userErrors: { message: string }[] } }>(
        `mutation($id: ID!, $t: [String!]!) { tagsRemove(id: $id, tags: $t) { userErrors { message } } }`,
        { id: p.id, t: [SALE_TAG] }
      );
      errs.push(...rem.tagsRemove.userErrors.map((e) => e.message));
    }
    report.push({ handle: p.handle, outcome: errs.length ? "failed" : back.length ? "restored" : "untagged", price, note: errs.join("; ") || undefined });
  }

  const tally = report.reduce<Record<string, number>>((t, r) => ((t[r.outcome] = (t[r.outcome] ?? 0) + 1), t), {});
  console.log(tally);
  for (const r of report.filter((x) => x.outcome === "failed")) console.log(`  failed: ${r.handle} — ${r.note}`);
  writeFileSync(join(__dirname, `report-restore-${apply ? "apply" : "dry"}.json`), JSON.stringify(report, null, 2));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
