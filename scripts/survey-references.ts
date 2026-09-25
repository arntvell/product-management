// Read-only survey of the category and brand vocabularies in every system.
//
//   npx dotenv -e .env.local -- npx tsx scripts/survey-references.ts [--apply]
//
// Without --apply nothing is written; it just reports what is out there. This is
// the step that sizes the merge work before anyone commits to a shape for it.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

async function main() {
  const { pullAllReferences } = await import("../src/lib/master/reference-pull.ts");
  const apply = process.argv.includes("--apply");
  // Read PRODUCTION by default. SITOO_TARGET is sandbox in local development,
  // and the sandbox is a different account with 570 unrelated products — a
  // survey of it would understate the real work by an order of magnitude.
  // These are GETs; the reconcile scripts read production routinely.
  const sitooTarget = process.argv.includes("--sandbox") ? "sandbox" : "production";

  const report = await pullAllReferences({ dryRun: !apply, sitooTarget });

  console.log("\n=== CATEGORIES ===");
  console.log(`${report.categories.found} values across systems`);
  for (const [sys, n] of Object.entries(report.categories.bySystem))
    console.log(`  ${sys.padEnd(8)} ${n}`);
  for (const n of report.categories.notes) console.log(`  · ${n}`);

  console.log("\n=== BRANDS ===");
  console.log(`${report.brands.found} values across systems`);
  for (const [sys, n] of Object.entries(report.brands.bySystem))
    console.log(`  ${sys.padEnd(8)} ${n}`);
  for (const n of report.brands.notes) console.log(`  · ${n}`);

  console.log(apply ? "\nWritten to the review queue." : "\nDry run — nothing written. Pass --apply.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
