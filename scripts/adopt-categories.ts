// Seed the Category model from Origio's own category strings and point existing
// products at it.
//
//   npx dotenv -e .env.local -- npx tsx scripts/adopt-categories.ts [--apply]
//
// Without --apply nothing is written. The text columns (Style.category,
// Colorway.productType) are left exactly as they are — this only fills the new
// categoryId alongside them.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

async function main() {
  const { adoptOrigioCategories } = await import("../src/lib/master/categories.ts");
  const apply = process.argv.includes("--apply");
  const r = await adoptOrigioCategories({ dryRun: !apply });
  console.log(
    `${r.dryRun ? "Would create" : "Created"} ${r.created} categories, ` +
      `${r.dryRun ? "map" : "mapped"} ${r.mappedValues} queue rows, ` +
      `${r.dryRun ? "point" : "pointed"} ${r.styles} styles and ${r.colorways} colorways.`
  );
  if (!apply) console.log("Dry run — pass --apply.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
