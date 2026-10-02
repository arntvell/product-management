// Is a vintage drop ready to be revealed?
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-drop-ready.ts "DROP 188"
//
// Read-only. Reveal removes the hide tags and publishes to the sales channels,
// so what has to be true first is: the garments exist, they are on Shopify,
// and they are still hidden.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

async function main() {
  const drop = process.argv[2] ?? "DROP 188";
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.ORIGO_POSTGRES_URL_NON_POOLING,
    }),
  });

  const entries = await prisma.seasonEntry.findMany({
    where: { drop },
    include: {
      colorway: {
        include: {
          style: true,
          publications: true,
          variants: { select: { variantSku: true, barcode: true } },
        },
      },
    },
  });

  console.log(`${drop}: ${entries.length} entries\n`);
  if (!entries.length) {
    await prisma.$disconnect();
    return;
  }

  let onShopify = 0;
  let missingShopify: string[] = [];
  for (const e of entries) {
    const cw = e.colorway;
    const shopify = cw.publications.find((c) => c.channel === "SHOPIFY");
    if (shopify?.externalId) onShopify++;
    else missingShopify.push(cw.colorwaySku);
  }

  console.log(`on Shopify        ${onShopify}/${entries.length}`);
  if (missingShopify.length)
    console.log(`NOT on Shopify    ${missingShopify.slice(0, 15).join(", ")}${missingShopify.length > 15 ? " …" : ""}`);

  const noBarcode = entries.filter((e) =>
    e.colorway.variants.some((v) => !v.barcode)
  ).length;
  console.log(`missing barcode   ${noBarcode}`);
  console.log(`\nsample: ${entries.slice(0, 3).map((e) => e.colorway.colorwaySku).join(", ")}`);

  await prisma.$disconnect();
}

main();
