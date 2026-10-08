// After scripts/vintage-split/apply.mjs has applied collapsed-split-plan.json:
// give each new colourway its own Shopify product, fill what Shopify knows, and
// record the push baseline.
//
//   npx tsx --env-file=.env.local scripts/collapsed-split/link.ts          (dry run)
//   npx tsx --env-file=.env.local scripts/collapsed-split/link.ts --apply
//
// The applier declares channels but sets no externalId, and each parent's
// SHOPIFY publication still points at whichever ONE product the importer linked
// it to — now owned by a new colourway. So:
//   1. each new colourway's SHOPIFY publication gets its own product gid;
//   2. each parent's is re-pointed at the product of the variant it still holds,
//      or cleared when it holds none (archived);
//   3. Refresh from Shopify fills the new colourways' empty fields (description,
//      details, swatch, care…) from their own products — the parent's
//      description belonged to one item, so none was carried;
//   4. the baseline is recorded, so nothing is pushed until someone edits.
// Nothing is written to Shopify.
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { syncShopifyFields } from "@/lib/master/sync-shopify-fields";
import { setShopifyBaseline } from "@/lib/master/shopify-update";

const APPLY = process.argv.includes("--apply");
const plan = JSON.parse(readFileSync("snapshots/collapsed-split-plan.json", "utf8")) as {
  oldColorways: { colorwayId: string; colorwaySku: string }[];
  plan: { variantId: string; newColorwaySku: string; shopifyProductGid: string | null }[];
};

(async () => {
  const linked: string[] = [];
  for (const row of plan.plan) {
    const cw = await prisma.colorway.findUnique({
      where: { colorwaySku: row.newColorwaySku },
      select: { id: true, variants: { select: { id: true } } },
    });
    if (!cw || !cw.variants.some((v) => v.id === row.variantId)) {
      console.log(`  ${row.newColorwaySku}: not split yet — skipped`);
      continue;
    }
    if (!row.shopifyProductGid) continue;
    console.log(`  ${row.newColorwaySku} -> ${row.shopifyProductGid}`);
    if (APPLY)
      await prisma.channelPublication.upsert({
        where: { colorwayId_channel: { colorwayId: cw.id, channel: "SHOPIFY" } },
        create: { colorwayId: cw.id, channel: "SHOPIFY", published: true, externalId: row.shopifyProductGid },
        update: { published: true, externalId: row.shopifyProductGid },
      });
    linked.push(cw.id);
  }

  for (const p of plan.oldColorways) {
    const left = await prisma.variant.findMany({
      where: { colorwayId: p.colorwayId },
      select: { variantSku: true, channelRefs: { where: { channel: "SHOPIFY" }, select: { externalId: true } } },
    });
    // Split, a parent holds at most the one variant a SKU collision kept back.
    if (left.length > 1) {
      console.log(`  parent ${p.colorwaySku}: ${left.length} variants — not split yet, left alone`);
      continue;
    }
    let gid: string | null = null;
    const variantGid = left[0]?.channelRefs[0]?.externalId;
    if (variantGid) {
      const d = await shopifyGraphQL<{ productVariant: { product: { id: string } } | null }>(
        `query($id: ID!) { productVariant(id: $id) { product { id } } }`,
        { id: variantGid }
      );
      gid = d.productVariant?.product.id ?? null;
    }
    console.log(`  parent ${p.colorwaySku}: ${left.length} variant(s) left -> SHOPIFY ${gid ?? "cleared"}`);
    if (APPLY)
      await prisma.channelPublication.updateMany({
        where: { colorwayId: p.colorwayId, channel: "SHOPIFY" },
        data: { externalId: gid, ...(gid ? {} : { published: false }) },
      });
    if (gid) linked.push(p.colorwayId);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${linked.length} colourways would be linked. Re-run with --apply.`);
    return prisma.$disconnect();
  }

  const fields = await syncShopifyFields({ apply: true, colorwayIds: linked });
  console.log(`\nRefresh from Shopify: ${fields.filled} colourways gained values`, fields.byField);
  for (const id of linked) await setShopifyBaseline(id);
  console.log(`Baselines recorded: ${linked.length}`);
  await prisma.$disconnect();
})();
