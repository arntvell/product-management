// Finish the 2026-09-11 Sitoo barcode correction for Mila White (LIV-ML-WHT).
//
//   npx tsx scripts/fix-mila-white-sitoo.ts            dry run, sends nothing
//   npx tsx scripts/fix-mila-white-sitoo.ts --apply    writes Sitoo production
//
// Run AFTER scripts/fix-mila-white-xl.ts, so XL is linked.
//
// The CFO register gives Mila White 70725360690xx/691xx; Sitoo still holds the
// older 70725360571xx run on M/S/XS/XL. The 09-11 plan (apply_sitoo.csv)
// corrected all five, but the push that ran (sitoo-push-29.csv) could only
// reach L, the one size the master held that day.
//
// Two steps:
//   1. pushBarcodesToSitoo for the five sizes. This is the existing push with
//      its rotation, lock, store-label and wrong-product guards; L already
//      agrees and is a no-op.
//   2. Each old 0571xx code is kept as a Sitoo barcode ALIAS on its own
//      product, so a garment still carrying an old label scans at the till.
//      L's 7072536057141 is included, since the 09-12 push dropped it without
//      one. The aliases are written after the primaries, so no code is ever on
//      two products at once.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

// Sitoo's barcodes as of 2026-09-11 (snapshots/2026-09-11/sitoo-products.json).
const OLD: Record<string, { productId: number; old: string }> = {
  "LIV-ML-WHT-XS": { productId: 11450, old: "7072536057110" },
  "LIV-ML-WHT-S": { productId: 11451, old: "7072536057127" },
  "LIV-ML-WHT-M": { productId: 11449, old: "7072536057134" },
  "LIV-ML-WHT-L": { productId: 11447, old: "7072536057141" },
  "LIV-ML-WHT-XL": { productId: 11448, old: "7072536057158" },
};

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { pushBarcodesToSitoo } = await import("../src/lib/sitoo/push.ts");
  const { getProduct, setBarcodeAliases, findProductsBySku } = await import("../src/lib/sitoo/client.ts");

  const vs = await prisma.variant.findMany({
    where: { variantSku: { in: Object.keys(OLD) } },
    select: { id: true, variantSku: true, barcode: true, channelRefs: { where: { channel: "SITOO" }, select: { externalId: true } } },
  });
  const problems: string[] = [];
  for (const sku of Object.keys(OLD)) {
    const v = vs.find((x) => x.variantSku === sku);
    if (!v) { problems.push(`${sku}: not in the master`); continue; }
    if (!v.barcode) problems.push(`${sku}: no master barcode (run fix-mila-white-xl.ts first?)`);
    if (v.channelRefs[0]?.externalId !== String(OLD[sku].productId)) problems.push(`${sku}: linked to Sitoo ${v.channelRefs[0]?.externalId ?? "nothing"}, expected ${OLD[sku].productId}`);
  }
  // An alias must not be any other product's code.
  for (const [sku, o] of Object.entries(OLD)) {
    const others = (await findProductsBySku([sku])).filter((p) => p.productid !== o.productId);
    if (others.length) problems.push(`${sku}: other Sitoo products share the SKU: ${others.map((p) => p.productid).join(",")}`);
  }
  for (const p of problems) console.log(`! ${p}`);
  if (problems.length) { await prisma.$disconnect(); process.exit(1); }

  const plan = await pushBarcodesToSitoo({ dryRun: true, variantIds: vs.map((v) => v.id) });
  console.log(`barcodes: ${plan.writes.length} write(s), ${plan.unchanged} unchanged, unwind ${plan.unwind.length}, ` +
    `refused: storeLabel ${plan.storeLabel.length} locked ${plan.locked.length} wrongProduct ${plan.wrongProduct.length}`);
  for (const w of plan.writes) console.log(`  ${w.variantSku} (${w.productId}) ${w.from} -> ${w.to}`);
  const refused = plan.storeLabel.length + plan.locked.length + plan.wrongProduct.length + plan.unwind.length;
  if (refused) { console.log("REFUSING: the push has refusals or an unwind; look before sending."); process.exit(1); }

  for (const [sku, o] of Object.entries(OLD)) {
    const cur = await getProduct(o.productId);
    const aliases: string[] = (cur as any).barcodealiases ?? [];
    console.log(`aliases: ${sku} (${o.productId}) now [${aliases.join(",")}] -> add ${o.old}${aliases.includes(o.old) ? " (already there)" : ""}`);
  }
  if (!APPLY) { console.log("DRY RUN — nothing sent. Add --apply."); await prisma.$disconnect(); return; }

  const res = await pushBarcodesToSitoo({ variantIds: vs.map((v) => v.id) });
  console.log(`pushed: applied ${res.applied}, failures ${res.failures.length}`);
  for (const f of res.failures) console.log(`  FAIL ${f.variantSku}: ${f.error}`);
  if (res.failures.length) { console.log("Stopping before aliases."); process.exit(1); }

  for (const [sku, o] of Object.entries(OLD)) {
    const cur: any = await getProduct(o.productId);
    const aliases: string[] = cur.barcodealiases ?? [];
    if (!aliases.includes(o.old)) await setBarcodeAliases(o.productId, [...aliases, o.old]);
    const back: any = await getProduct(o.productId);
    console.log(`read back ${sku} (${o.productId}) barcode ${back.barcode} aliases [${(back.barcodealiases ?? []).join(",")}]`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
