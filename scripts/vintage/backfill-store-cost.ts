// Give every store-vintage garment the cost price the house rule implies.
//
//   npx dotenv -e .env.local -- npx tsx scripts/vintage/backfill-store-cost.ts [--apply]
//
// 245 of the 251 store-vintage colorways hold no COST row, so the till was
// written "0.00" — a 100% margin in every report that reads it. The rule is 30%
// of the net retail price, and net means after the 25% VAT the shelf price
// includes; see storeVintageCostNok.
//
// Only fills a gap. A colorway that already has a COST is left exactly as it is,
// because a real invoice price beats a derived one — and only store vintage is
// touched: the online drops have their own cost handling in vintage.ts.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { storeVintageCostNok } from "../../src/lib/master/vintage.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_URL_NON_POOLING }),
});

async function main() {
  const apply = process.argv.includes("--apply");

  const cws = await prisma.colorway.findMany({
    where: {
      brand: { name: "Vintage" },
      variants: { some: { channelRefs: { some: { channel: "SITOO" } } } },
    },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      entries: { select: { season: { select: { id: true, code: true } } } },
      prices: { where: { currency: "NOK" }, select: { priceType: true, amount: true, seasonId: true } },
    },
  });

  const plan: { id: string; sku: string; seasonId: string; msrp: number; cost: number }[] = [];
  const skipped: string[] = [];
  for (const c of cws) {
    if (c.prices.some((p) => p.priceType === "COST" && Number(p.amount) > 0)) {
      skipped.push(`${c.colorwaySku} (has a cost)`);
      continue;
    }
    const msrp = c.prices.find((p) => p.priceType === "MSRP");
    const cost = storeVintageCostNok(msrp?.amount as unknown as number);
    // No retail price means nothing to derive from; those are a data gap of
    // their own and this is not the script that fixes them.
    if (!msrp || cost == null) {
      skipped.push(`${c.colorwaySku} (no NOK MSRP)`);
      continue;
    }
    plan.push({
      id: c.id,
      sku: c.colorwaySku,
      seasonId: msrp.seasonId,
      msrp: Number(msrp.amount),
      cost,
    });
  }

  console.log(`  store-vintage colorways: ${cws.length}`);
  console.log(`  would write a COST row  : ${plan.length}`);
  console.log(`  skipped                 : ${skipped.length}`);
  skipped.slice(0, 8).forEach((s) => console.log(`      ${s}`));
  console.log(`\n  first rows:`);
  plan.slice(0, 10).forEach((r) =>
    console.log(`    ${r.sku.padEnd(22)} msrp ${String(r.msrp).padStart(6)} -> cost ${r.cost.toFixed(2).padStart(8)}`)
  );

  if (!apply) {
    console.log(`\n  DRY RUN — nothing written. Pass --apply to write.`);
    return;
  }

  let written = 0;
  for (let i = 0; i < plan.length; i += 25) {
    await Promise.all(
      plan.slice(i, i + 25).map((r) =>
        prisma.price.upsert({
          where: {
            seasonId_colorwayId_currency_priceType: {
              seasonId: r.seasonId,
              colorwayId: r.id,
              currency: "NOK",
              priceType: "COST",
            },
          },
          create: {
            seasonId: r.seasonId,
            colorwayId: r.id,
            currency: "NOK",
            priceType: "COST",
            amount: r.cost,
          },
          update: { amount: r.cost },
        })
      )
    );
    written += Math.min(25, plan.length - i);
  }
  console.log(`\n  written: ${written}`);
}

main().finally(() => prisma.$disconnect());
