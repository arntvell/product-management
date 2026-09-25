// What the master could actually tell Shopify about customs, and what it can't.
//
//   npx dotenv -e .env.local -- npx tsx scripts/customs-audit.ts
//
// Read-only. Run this BEFORE writing customs anywhere: the unresolved-country
// list is where the real work is, and a country Shopify does not recognise makes
// it reject the whole product mutation, not just that field.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { resolveCustoms, isEmptyCustoms } from "../src/lib/master/customs-shopify.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

async function main() {
  const colorways = await prisma.colorway.findMany({
    where: { archived: false, kind: "MERCHANDISE" },
    select: {
      id: true,
      colorwaySku: true,
      hsCodeOverride: true,
      customsDescriptionOverride: true,
      weightKgOverride: true,
      fiberCompositionOverride: true,
      countryOfOrigin: true,
      style: {
        select: { hsCode: true, customsDescription: true, weightKg: true, fiberComposition: true },
      },
      publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
    },
  });

  let hs = 0, country = 0, weight = 0, complete = 0, empty = 0, onShopify = 0;
  const unresolved = new Map<string, number>();

  for (const cw of colorways) {
    const c = resolveCustoms(cw);
    if (cw.publications[0]?.externalId) onShopify++;
    if (c.hsCode) hs++;
    if (c.countryCode) country++;
    if (c.weightKg !== null) weight++;
    if (c.hsCode && c.countryCode && c.weightKg !== null) complete++;
    if (isEmptyCustoms(c)) empty++;
    if (c.countryUnresolved)
      unresolved.set(c.countryUnresolved, (unresolved.get(c.countryUnresolved) ?? 0) + 1);
  }

  const n = colorways.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`\nLive merchandise colorways: ${n} (${onShopify} with a Shopify product)\n`);
  console.log(`  HS code            ${String(hs).padStart(5)}  ${pct(hs)}`);
  console.log(`  Country resolves   ${String(country).padStart(5)}  ${pct(country)}`);
  console.log(`  Weight             ${String(weight).padStart(5)}  ${pct(weight)}`);
  console.log(`  All three          ${String(complete).padStart(5)}  ${pct(complete)}`);
  console.log(`  Nothing to send    ${String(empty).padStart(5)}  ${pct(empty)}`);

  if (unresolved.size) {
    console.log(`\nCountry spellings that do NOT resolve to an ISO code (${unresolved.size}):`);
    for (const [name, count] of [...unresolved].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(count).padStart(5)}  ${name}`);
    console.log(
      "\nThese are omitted rather than guessed — a bad CountryCode enum value makes\n" +
        "Shopify reject the ENTIRE product mutation. Fix them in the master first."
    );
  } else {
    console.log("\nEvery country spelling resolves.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
