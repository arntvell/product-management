// Give Mila White XL (LIV-ML-WHT-XL) its barcode and channel links in the master.
//
//   npx tsx scripts/fix-mila-white-xl.ts            dry run
//   npx tsx scripts/fix-mila-white-xl.ts --apply    writes Origio only
//
// The CFO barcode register (snapshots/2026-09-11/worklists/barcodes-2026-09-11.csv,
// codes issued 2026-03-30) gives XL 7072536069113, as do Cin7 and Shopify. The
// 2026-09-11 plan filled the master and corrected Sitoo for all five Mila White
// sizes, but on that day the master held only L. The Cin7 backfill brought
// M/S/XS the next day; XL never arrived with a code, so it stayed blank and
// unlinked while Shopify and Sitoo both carry it.
//
// This fills the blank barcode (never overwrites) and writes exactly two
// VariantChannelRefs, read live by SKU: Sitoo product 11448 and the Shopify
// variant. The catalogue-wide linkers are deliberately not used, since one
// size does not justify a full-catalogue pass with membership sync. Sends
// nothing to any channel; Sitoo's barcode is a separate, confirmed step.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const SKU = "LIV-ML-WHT-XL";
const BARCODE = "7072536069113";
const SITOO_PRODUCT = 11448;

async function main() {
  const { prisma } = await import("../src/lib/db.ts");
  const { getProduct } = await import("../src/lib/sitoo/client.ts");
  const { shopifyGraphQL } = await import("../src/lib/shopify/client.ts");
  const { applyBarcodeCorrections } = await import("../src/lib/master/apply-barcodes.ts");

  const v = await prisma.variant.findUnique({
    where: { variantSku: SKU },
    select: { id: true, barcode: true, colorway: { select: { colorwaySku: true } }, channelRefs: true },
  });
  if (!v) throw new Error(`${SKU} not in the master`);
  const holder = await prisma.variant.findUnique({ where: { barcode: BARCODE }, select: { variantSku: true } });

  const sitoo = await getProduct(SITOO_PRODUCT);
  const d: any = await shopifyGraphQL(
    `{ productVariants(first: 5, query: "sku:${SKU}") { nodes { id sku barcode inventoryItem { id } product { id title status } } } }`
  );
  const shop = d.productVariants.nodes.filter((n: any) => n.sku === SKU);

  const problems: string[] = [];
  if (v.barcode && v.barcode !== BARCODE) problems.push(`master already holds ${v.barcode}; this never overwrites`);
  if (holder && holder.variantSku !== SKU) problems.push(`${BARCODE} is held by ${holder.variantSku}`);
  if (sitoo.sku !== SKU) problems.push(`Sitoo ${SITOO_PRODUCT} is ${sitoo.sku}, not ${SKU}`);
  if (shop.length !== 1) problems.push(`Shopify has ${shop.length} variants with SKU ${SKU}`);
  else if (shop[0].barcode !== BARCODE) problems.push(`Shopify's ${SKU} has barcode ${shop[0].barcode}`);
  for (const r of v.channelRefs) problems.push(`already linked to ${r.channel} ${r.externalId}; refusing to guess`);

  console.log(`${SKU} (${v.colorway.colorwaySku}) master barcode ${v.barcode ?? "blank"} -> ${BARCODE}`);
  console.log(`  Sitoo   ${SITOO_PRODUCT} sku ${sitoo.sku} barcode ${sitoo.barcode} (corrected separately)`);
  if (shop[0]) console.log(`  Shopify ${shop[0].id} barcode ${shop[0].barcode} inv ${shop[0].inventoryItem.id} on "${shop[0].product.title}" ${shop[0].product.status}`);
  for (const p of problems) console.log(`  ! ${p}`);
  if (problems.length) { await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("  DRY RUN — nothing written. Add --apply."); await prisma.$disconnect(); return; }

  if (!v.barcode) {
    const res = await applyBarcodeCorrections([{ variantSku: SKU, barcode: BARCODE }], {
      authority: "cfo-list-2026-09-11",
      evidence: "snapshots/2026-09-11/worklists/barcodes-2026-09-11.csv (Product Code 06911, added 2026-03-30)",
    });
    console.log("  barcode:", JSON.stringify(res).slice(0, 300));
  }
  await prisma.variantChannelRef.createMany({
    data: [
      { variantId: v.id, channel: "SITOO", externalId: String(SITOO_PRODUCT) },
      { variantId: v.id, channel: "SHOPIFY", externalId: shop[0].id, externalInventoryId: shop[0].inventoryItem.id },
    ],
  });
  const back = await prisma.variant.findUnique({ where: { id: v.id }, select: { barcode: true, channelRefs: { select: { channel: true, externalId: true, externalInventoryId: true } } } });
  console.log("  read back:", JSON.stringify(back));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
