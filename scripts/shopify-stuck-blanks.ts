// Find, and with --apply release, Shopify fields a push will never send:
// the master has a value, Shopify is blank, and the baseline claims they agree.
// See "Stuck blanks" in src/lib/master/shopify-update.ts.
//
//   npx tsx scripts/shopify-stuck-blanks.ts --sku=EXT-A,EXT-B          dry run
//   npx tsx scripts/shopify-stuck-blanks.ts --sku=EXT-A,EXT-B --apply  writes the baseline
//
// Writes ORIGIO only, and only the baseline: nothing is sent to Shopify. After
// --apply, an ordinary push (Push in External Products) sends the released fields.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const SKUS = (process.argv.find((a) => a.startsWith("--sku="))?.slice(6) ?? "").split(",").filter(Boolean);

async function main() {
  if (!SKUS.length) throw new Error("Pass --sku=<colorway SKU>[,…]");
  const { prisma } = await import("../src/lib/db.ts");
  const { findStuckBlanks, releaseStuckBlanks } = await import("../src/lib/master/shopify-update.ts");

  for (const sku of SKUS) {
    const cw = await prisma.colorway.findUnique({ where: { colorwaySku: sku }, select: { id: true } });
    if (!cw) { console.log(`${sku}: not in the master`); continue; }
    const f = await findStuckBlanks(cw.id);
    if (!f) { console.log(`${sku}: not on Shopify, or no baseline`); continue; }
    console.log(`${sku}  ${f.productGid}  season ${f.seasonCode || "-"}`);
    for (const s of f.stuck) console.log(`  stuck: ${s.label.padEnd(18)} ${s.master.replace(/\s+/g, " ").slice(0, 70)}`);
    if (!f.stuck.length) console.log("  nothing stuck");
    if (f.status.master !== f.status.shopify)
      console.log(`  status: Origo ${f.status.master}, Shopify ${f.status.shopify} — not released; a publish decision, not a blank`);
    if (APPLY && f.stuck.length) console.log(`  released ${await releaseStuckBlanks(f)} baseline key(s)`);
  }
  if (!APPLY) console.log("\nDRY RUN — nothing written. Add --apply.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
