// Fill custom.same_product on every live Livid product. Rule: src/lib/master/same-product.ts
//
//   npx dotenv -e .env.local -- npx tsx scripts/same-product/fill.ts           # dry run
//   npx dotenv -e .env.local -- npx tsx scripts/same-product/fill.ts --apply
import { runSameProduct } from "@/lib/master/same-product";

(async () => {
  const apply = process.argv.includes("--apply");
  const r = await runSameProduct({ apply });
  console.log(`live Livid products: ${r.liveProducts} — unchanged ${r.unchanged}, to update ${r.changes.length} (+${r.linksAdded} links, -${r.linksDropped})`);
  for (const c of r.changes)
    console.log(`  ${c.sku.padEnd(30)} ${c.list.length} colour(s)` +
      (c.add.length ? `  +${c.add.map((g) => r.labels[g]).join(", ")}` : "") +
      (c.drop.length ? `  -${c.drop.map((g) => r.labels[g]).join(", ")}` : ""));
  console.log(`Origio out of step with Shopify (Origio-only fix): ${r.origioFixes.length}${apply ? `, fixed ${r.origioFixed}` : ""}`);
  console.log(`Not on Shopify yet (FW26/SS27), list set in Origio: ${r.prelaunch.length}${apply ? `, set ${r.prelaunchFixed}` : ""}`);
  if (apply) console.log(`\nwritten ${r.written} of ${r.changes.length}${r.errors.length ? `\nerrors:\n- ${r.errors.join("\n- ")}` : ""}`);
  else console.log("\nDry run — nothing written. Add --apply.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
