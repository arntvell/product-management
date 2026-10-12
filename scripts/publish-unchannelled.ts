// Products Origo created in Shopify that sit on no sales channel.
//
//   npx dotenv -e .env.local -- npx tsx scripts/publish-unchannelled.ts
//   npx dotenv -e .env.local -- npx tsx scripts/publish-unchannelled.ts --apply
//
// Until 2026-10-12 a create from Origo set the product's status but never
// published it, so an ACTIVE product could be invisible on every channel.
// Creates now publish (push-shopify.ts); this puts the earlier ones right.
//
// WITHOUT --apply it writes NOTHING: it lists every candidate and why the
// others are left alone. WITH --apply it publishes the listed products to the
// store's sales channels — the same revealProducts() a create now calls, with
// the tags untouched.
//
// Left alone, on purpose:
//   vintage            hidden until its drop is revealed; reveal publishes it
//   hide / rocket-hide tagged as hidden by someone — not ours to undo
//   ARCHIVED           off sale
//   (Caveat: Shopify reports a DRAFT as unpublished on every channel even
//   once it has been added to them, so drafts stay in this list after
//   --apply. Only an ACTIVE product's channels can be read back here; for a
//   draft, check "Sales channels" on the product in Shopify admin.)
//
// Also left alone:
//   not made by Origo  a product that existed in Shopify before Origo knew of
//                      it (old drafts made by hand, imports) — Origo only
//                      linked it, and whoever left it a draft off the
//                      channels may have meant to

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { shopifyGraphQL } from "../src/lib/shopify/client.ts";
import { HIDE_TAGS, revealProducts } from "../src/lib/shopify/reveal.ts";

const NODES = `
  query N($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        createdAt
        status
        vendor
        tags
        resourcePublicationsV2(first: 25) { nodes { isPublished } }
      }
    }
  }
`;

type P = {
  id: string;
  title: string;
  createdAt: string;
  status: string;
  vendor: string;
  tags: string[];
  resourcePublicationsV2: { nodes: { isPublished: boolean }[] };
};

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_URL_NON_POOLING }),
  });

  const pubs = await prisma.channelPublication.findMany({
    where: {
      channel: "SHOPIFY",
      externalId: { startsWith: "gid://shopify/Product/" },
      // Origo made it: pushed from Origo at least once…
      lastPushedAt: { not: null },
    },
    select: { externalId: true, colorway: { select: { colorwaySku: true, createdAt: true } } },
  });
  const skuByGid = new Map(pubs.map((p) => [p.externalId!, p.colorway]));
  const gids = [...skuByGid.keys()];
  console.log(`${gids.length} Shopify product(s) pushed from Origo at least once\n`);

  const products: P[] = [];
  let missing = 0;
  for (let i = 0; i < gids.length; i += 100) {
    const r = await shopifyGraphQL<{ nodes: (P | null)[] }>(NODES, { ids: gids.slice(i, i + 100) });
    for (const n of r.nodes) {
      if (n?.id) products.push(n);
      else missing++;
    }
  }

  const unchannelled = products.filter((p) => !p.resourcePublicationsV2.nodes.some((n) => n.isPublished));
  const skip: Record<string, P[]> = {
    "existed in Shopify before Origo": [],
    vintage: [],
    "hide-tagged": [],
    archived: [],
  };
  const todo: P[] = [];
  for (const p of unchannelled) {
    // …and the Shopify product is younger than Origo's record of it, so the
    // push created it rather than updated something already there.
    const origoSince = skuByGid.get(p.id)?.createdAt;
    if (!origoSince || new Date(p.createdAt) < origoSince) skip["existed in Shopify before Origo"].push(p);
    else if (/vintage/i.test(p.vendor)) skip.vintage.push(p);
    else if (p.tags.some((t) => (HIDE_TAGS as readonly string[]).includes(t))) skip["hide-tagged"].push(p);
    else if (p.status === "ARCHIVED") skip.archived.push(p);
    else todo.push(p);
  }

  const line = (p: P) =>
    `  ${(skuByGid.get(p.id)?.colorwaySku ?? "?").padEnd(28)} ${p.status.padEnd(7)} ${p.vendor.padEnd(16)} ${p.title}`;
  console.log(`On no sales channel: ${unchannelled.length}`);
  if (missing) console.log(`(${missing} linked id(s) no longer exist in Shopify — ignored)`);
  for (const [why, list] of Object.entries(skip))
    if (list.length) console.log(`  left alone, ${why}: ${list.length}`);

  console.log(`\nTo publish: ${todo.length}`);
  const byVendor = new Map<string, number>();
  for (const p of todo) byVendor.set(p.vendor, (byVendor.get(p.vendor) ?? 0) + 1);
  for (const [v, n] of [...byVendor].sort((a, b) => b[1] - a[1])) console.log(`  ${v}: ${n}`);
  console.log();
  for (const p of todo.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.title.localeCompare(b.title)))
    console.log(line(p));

  const drafts = todo.filter((p) => p.status === "DRAFT").length;
  if (drafts)
    console.log(
      `\n${drafts} of these are drafts. Shopify reads every draft back as unpublished, so they ` +
        `stay listed here even after --apply — check one's Sales channels in Shopify admin.`
    );

  if (!apply) {
    console.log(`\nNothing written. Re-run with --apply to publish these ${todo.length}.`);
  } else if (todo.length) {
    console.log(`\nPublishing ${todo.length} …`);
    const res = await revealProducts(
      todo.map((p) => p.id),
      { removeTags: false, publish: true }
    );
    console.log(`Published: ${res.published.length} of ${todo.length}`);
    for (const w of res.warnings) console.log(`  ! ${w}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
