// Stock every existing Shopify product at every active location, at 0 — the
// one-off for products pushed before lib/shopify/locations.ts ran on every push.
// Same helper, so the same rules: tracked sizes only, ARCHIVED products skipped,
// no quantity ever written. A re-run is a no-op.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/shopify-locations/backfill.ts
//       dry run: what is missing, nothing written
//   … backfill.ts --only <productGid>      one product (dry run unless --apply)
//   … backfill.ts --apply                   everything
//
// Writes a report to scripts/shopify-locations/report-<dry|apply>.json.
import { writeFileSync } from "node:fs";
import { shopifyGraphQL } from "../../src/lib/shopify/client";
import { ensureStockedEverywhere } from "../../src/lib/shopify/locations";

const apply = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

async function productIds(): Promise<string[]> {
  if (only) return [only];
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const r: { products: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } =
      await shopifyGraphQL(
        `query($after: String) { products(first: 250, after: $after, query: "-status:archived") {
           nodes { id } pageInfo { hasNextPage endCursor } } }`,
        { after }
      );
    ids.push(...r.products.nodes.map((n) => n.id));
    after = r.products.pageInfo.hasNextPage ? r.products.pageInfo.endCursor : null;
  } while (after);
  return ids;
}

async function main() {
  const ids = await productIds();
  console.log(`${ids.length} non-archived product(s); ${apply ? "APPLYING" : "dry run"}`);
  const report: { productGid: string; activated: string[]; warnings: string[] }[] = [];
  let activations = 0;
  let warnings = 0;
  const POOL = 4;
  for (let i = 0; i < ids.length; i += POOL) {
    const batch = await Promise.all(
      ids.slice(i, i + POOL).map(async (id) => ({ productGid: id, ...(await ensureStockedEverywhere(id, { dryRun: !apply })) }))
    );
    for (const r of batch) {
      activations += r.activated.length;
      warnings += r.warnings.length;
      if (r.activated.length || r.warnings.length) report.push(r);
      for (const w of r.warnings) console.log(`  ! ${w}`);
    }
    if ((i / POOL) % 50 === 0) console.log(`  ${Math.min(i + POOL, ids.length)}/${ids.length} — ${activations} location(s) ${apply ? "switched on" : "missing"}`);
  }
  const sizes = new Set(report.flatMap((r) => r.activated.map((a) => a.split(" @ ")[0]))).size;
  console.log(
    `\n${report.length} product(s), ${sizes} size(s), ${activations} location(s) ${apply ? "switched on" : "missing"}; ${warnings} warning(s).`
  );
  writeFileSync(`${__dirname}/report-${apply ? "apply" : "dry"}.json`, JSON.stringify(report, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
