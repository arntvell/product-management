// Are a drop's garments still hidden on Shopify, i.e. is there anything for
// the reveal to do?
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-drop-hidden.ts "DROP 188"
//
// Read-only: one query per sampled product, no mutations.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { shopifyGraphQL } from "../src/lib/shopify/client.ts";
import { HIDE_TAGS } from "../src/lib/shopify/reveal.ts";

const QUERY = `
  query P($id: ID!) {
    product(id: $id) {
      id
      title
      status
      tags
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { id } } }
    }
  }
`;

async function main() {
  const drop = process.argv[2] ?? "DROP 188";
  const limit = Number(process.argv[3] ?? 5);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_URL_NON_POOLING }),
  });

  const entries = await prisma.seasonEntry.findMany({
    where: { drop },
    include: { colorway: { include: { publications: true } } },
  });

  const ids = entries
    .map((e) => ({
      sku: e.colorway.colorwaySku,
      gid: e.colorway.publications.find((p) => p.channel === "SHOPIFY")?.externalId,
    }))
    .filter((x): x is { sku: string; gid: string } => !!x.gid);

  console.log(`${drop}: ${ids.length} on Shopify, sampling ${Math.min(limit, ids.length)}\n`);

  for (const { sku, gid } of ids.slice(0, limit)) {
    const d = await shopifyGraphQL<{
      product: {
        title: string; status: string; tags: string[];
        resourcePublicationsV2: { nodes: { isPublished: boolean }[] };
      } | null;
    }>(QUERY, { id: gid });
    const p = d.product;
    if (!p) { console.log(`${sku}  NOT FOUND on Shopify (${gid})`); continue; }
    const hide = HIDE_TAGS.filter((t) => p.tags.includes(t));
    const pubs = p.resourcePublicationsV2.nodes;
    const published = pubs.filter((n) => n.isPublished).length;
    console.log(
      `${sku}  status=${p.status}  hideTags=[${hide.join(",") || "none"}]  published=${published}/${pubs.length}`
    );
  }

  await prisma.$disconnect();
}

main();
