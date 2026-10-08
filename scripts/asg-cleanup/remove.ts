// Remove A Soft Grind's 69 mis-imported colourways, so the corrected file can be
// imported cleanly. 2026-10-08.
//
//   npx tsx --env-file=.env.local scripts/asg-cleanup/remove.ts           (preview)
//   npx tsx --env-file=.env.local scripts/asg-cleanup/remove.ts --apply
//
// What went wrong: the import file's Colorway column was dragged down from
// "925 Silver", and Excel counted it up — 926, 927 … 993. Every size row became
// its own colourway, so 7 rings × 9 sizes went out as 63 one-size products
// (plus 6 one-size items with wrong numbers), to Shopify, Sitoo and Loom.
//
// Why remove rather than repair: everything is from today, every Shopify product
// is a DRAFT with no stock and no orders (re-checked below before anything is
// written), and a repair would leave the wrong number inside every SKU.
//
// What this does, in this order:
//   1. Shopify — deletes the 69 draft products. Refuses if any is not DRAFT, has
//      stock, or appears on an order.
//   2. Loom    — withdraws the 69 (channels.loom = false; Loom keeps history).
//   3. Origo   — deletes the 69 colourways; their sizes, prices, channel links
//      and edit history go with them. The brand and the 13 styles stay: their
//      names are right, and the re-import reuses a style by name.
//
// What it does NOT do: delete in Sitoo. Origo never deletes live till product
// (sitoo/client.ts deleteProduct, after 12 September). The 69 EXT-ASG… products
// are deleted by a person in Sitoo admin, BEFORE the corrected import is pushed
// — otherwise the till ends up with two products per barcode.
//
// A backup of everything removed is written to snapshots/asg-cleanup-backup.json.
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { pushColorwaysToLoom } from "@/lib/loom/push";

const APPLY = process.argv.includes("--apply");

async function main() {
  const brand = await prisma.brand.findFirst({ where: { skuToken: "ASG", name: "A Soft Grind" } });
  if (!brand) throw new Error("A Soft Grind not found");

  const cws = await prisma.colorway.findMany({
    where: { brandId: brand.id },
    include: {
      variants: { include: { channelRefs: true } },
      publications: true,
      prices: true,
      entries: { include: { season: { select: { code: true } } } },
      style: { select: { styleSku: true, styleName: true } },
    },
  });
  // The fingerprint of the mistake: every name is "<3 digits> Silver" and every
  // colourway holds exactly one size. Anything else means the brand has moved
  // on since this was written — stop rather than delete it.
  const off = cws.filter((c) => !/^9\d\d Silver$/.test(c.name) || c.variants.length !== 1);
  if (cws.length !== 69 || off.length)
    throw new Error(
      `Expected exactly the 69 mis-imported colourways; found ${cws.length}` +
        (off.length ? `, and ${off.length} that do not fit (${off.slice(0, 5).map((c) => c.colorwaySku).join(", ")})` : "") +
        ". Nothing was touched."
    );

  // --- Shopify pre-checks ----------------------------------------------------
  const gids = cws
    .map((c) => c.publications.find((p) => p.channel === "SHOPIFY")?.externalId)
    .filter((g): g is string => !!g);
  const blockers: string[] = [];
  for (let i = 0; i < gids.length; i += 50) {
    const d = await shopifyGraphQL<{ nodes: ({ id: string; title: string; status: string; totalInventory: number } | null)[] }>(
      `query($ids:[ID!]!){nodes(ids:$ids){... on Product{id title status totalInventory}}}`,
      { ids: gids.slice(i, i + 50) }
    );
    for (const n of d.nodes) {
      if (!n) continue;
      if (n.status !== "DRAFT") blockers.push(`${n.title} is ${n.status} on Shopify`);
      if ((n.totalInventory ?? 0) !== 0) blockers.push(`${n.title} has ${n.totalInventory} in stock on Shopify`);
    }
  }
  try {
    const o = await shopifyGraphQL<{ orders: { nodes: { name: string }[] } }>(
      `{orders(first:5,query:"sku:EXT-ASG*"){nodes{name}}}`
    );
    if (o.orders.nodes.length) blockers.push(`Shopify orders carry ASG SKUs: ${o.orders.nodes.map((x) => x.name).join(", ")}`);
  } catch (e) {
    blockers.push(`Could not read Shopify orders, so a sale cannot be ruled out: ${String(e).slice(0, 120)}`);
  }
  if (blockers.length) throw new Error(`Refusing:\n  ${blockers.join("\n  ")}`);

  const backup = cws.map((c) => ({
    colorwayId: c.id,
    colorwaySku: c.colorwaySku,
    name: c.name,
    style: c.style,
    status: c.status,
    seasons: c.entries.map((e) => e.season.code),
    prices: c.prices.map((p) => ({ type: p.priceType, currency: p.currency, amount: p.amount.toString() })),
    publications: c.publications.map((p) => ({ channel: p.channel, externalId: p.externalId })),
    variants: c.variants.map((v) => ({
      variantSku: v.variantSku,
      sizeLabel: v.sizeLabel,
      barcode: v.barcode,
      refs: v.channelRefs.map((r) => ({ channel: r.channel, externalId: r.externalId })),
    })),
  }));
  writeFileSync("snapshots/asg-cleanup-backup.json", JSON.stringify(backup, null, 1));

  const sitooIds = backup.flatMap((b) => b.variants.flatMap((v) => v.refs.filter((r) => r.channel === "SITOO").map((r) => r.externalId)));
  console.log(
    `${cws.length} colourways, ${gids.length} Shopify drafts (no stock, no orders), ` +
      `${sitooIds.length} Sitoo products (ids ${Math.min(...sitooIds.map(Number))}–${Math.max(...sitooIds.map(Number))}).`
  );
  console.log("Backup written to snapshots/asg-cleanup-backup.json");

  if (!APPLY) {
    console.log("\nPREVIEW — nothing written. Re-run with --apply.");
    return;
  }

  // --- 1. Shopify ------------------------------------------------------------
  let deleted = 0;
  for (const id of gids) {
    const r = await shopifyGraphQL<{ productDelete: { deletedProductId: string | null; userErrors: { message: string }[] } }>(
      `mutation($input: ProductDeleteInput!){ productDelete(input:$input){ deletedProductId userErrors{ message } } }`,
      { input: { id } }
    );
    if (r.productDelete.userErrors.length)
      throw new Error(`Shopify refused ${id}: ${r.productDelete.userErrors.map((e) => e.message).join(", ")} (deleted so far: ${deleted})`);
    deleted++;
  }
  console.log(`Shopify: deleted ${deleted} draft products`);

  // --- 2. Loom ---------------------------------------------------------------
  const ids = cws.map((c) => c.id);
  const season = cws[0].entries[0]?.season.code ?? "CONTINUITY";
  const loom = await pushColorwaysToLoom(ids, season, { mode: "data", archiveColorwayIds: ids });
  console.log("Loom: withdrawal sent", JSON.stringify(loom).slice(0, 300));

  // --- 3. Origo --------------------------------------------------------------
  const variantIds = cws.flatMap((c) => c.variants.map((v) => v.id));
  await prisma.$transaction([
    prisma.fieldOwner.deleteMany({ where: { entityType: "colorway", entityId: { in: ids } } }),
    prisma.fieldOwner.deleteMany({ where: { entityType: "variant", entityId: { in: variantIds } } }),
    prisma.colorway.deleteMany({ where: { id: { in: ids } } }),
  ]);
  const left = await prisma.colorway.count({ where: { brandId: brand.id } });
  console.log(`Origo: removed ${ids.length} colourways (A Soft Grind now has ${left}); brand and 13 styles kept`);

  console.log(
    "\nNEXT: delete the EXT-ASG… products in Sitoo admin, THEN re-import the corrected file and push."
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
