// Confirm every pulled brand/category value that matches exactly one Origio row.
//
//   npx dotenv -e .env.local -- npx tsx scripts/link-exact-references.ts [--apply]
//
// Default is a dry run. Writes nothing to any channel either way — it records
// which external object each brand/category already IS, which is what stops a
// second one being created.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { linkExactBrandRefs } from "../src/lib/master/brands.ts";
import { linkExactCategoryValues, reconcileCategoryOutbound } from "../src/lib/master/categories.ts";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — nothing is written\n");

  const b = await linkExactBrandRefs({ dryRun: !APPLY });
  console.log(`BRANDS   linked ${b.linked}, ambiguous ${b.ambiguous.length}, unmatched ${b.unmatched.length}`);
  for (const a of b.ambiguous) console.log(`   ambiguous  ${a.system} "${a.externalName}" -> ${a.candidates.join(" / ")}`);
  for (const u of b.unmatched.sort((x, y) => y.productCount - x.productCount))
    console.log(`   unmatched  ${u.system.padEnd(8)} ${u.externalName.padEnd(26)}${u.externalId ? `id ${u.externalId}`.padEnd(9) : "".padEnd(9)} ${u.productCount} products`);

  const c = await linkExactCategoryValues({ dryRun: !APPLY });
  console.log(`\nCATEGORIES linked ${Object.entries(c.linked).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`   Sitoo ids stored: ${c.sitooIds}   Loom words stored: ${c.loomWords}`);
  console.log(`   ambiguous ${c.ambiguous.length}, unmatched ${c.unmatched.length}, channel-side duplicates ${c.collisions.length}`);
  for (const x of c.collisions)
    console.log(`   DUPLICATE IN ${x.system}: "${x.category}" — kept ${x.kept}, also present ${x.dropped.join(", ")}`);
  for (const a of c.ambiguous) console.log(`   ambiguous  ${a.system} "${a.externalName}" -> ${a.candidates.join(" / ")}`);
  for (const u of c.unmatched.sort((x, y) => y.productCount - x.productCount))
    console.log(`   unmatched  ${u.system.padEnd(8)} ${u.externalName.padEnd(26)}${u.system === "SITOO" ? `id ${u.externalKey}`.padEnd(9) : "".padEnd(9)} ${u.productCount} products`);

  const rec = await reconcileCategoryOutbound({ dryRun: !APPLY });
  console.log(`\nOutbound reconcile: ${rec.changed.length} correction(s)`);
  for (const x of rec.changed)
    console.log(`   ${x.system} "${x.category}"  ${x.from ?? "(null)"} -> ${x.to}`);

  await prisma.$disconnect();
}
main();
