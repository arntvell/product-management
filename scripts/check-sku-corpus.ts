// Proves the SKU-corpus narrowing in src/lib/master/sku-corpus.ts loses nothing.
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-sku-corpus.ts
//
// Reads every colorway SKU, then treats each one as a proposed SKU and compares
// findNearDuplicates over the FULL corpus against the NARROWED one. Any
// difference is a match the narrowing would have hidden, and the script exits 1.
//
// This is the check that makes the optimisation safe to believe. Run it again if
// compareSku's rules ever change — the narrowing is derived from them, so a new
// match tier could invalidate it silently.
//
// Last run: 4,607 SKUs, 0 matches lost, average corpus 4,607 -> 197 (95.7% less).

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { findNearDuplicates, parseSku } from "../src/lib/master/sku.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

// The narrowing rule, inlined so this tests the rule and not the DB plumbing.
function narrow(candidate: string, full: string[]): string[] {
  const body = parseSku(candidate).body;
  const token = [...body].sort((a, b) => b.length - a.length)[0];
  if (!token || token.length < 3) return full;
  const t = token.toUpperCase();
  return full.filter((s) => s.toUpperCase().includes(t));
}

async function main() {
  const rows = await prisma.colorway.findMany({ select: { colorwaySku: true } });
  const full = rows.map((r) => r.colorwaySku);
  console.log(`corpus: ${full.length} colorway SKUs`);

  // Test every real SKU as if it were being proposed. This is the strongest
  // version of the check — each one has at least itself as a match.
  let mismatches = 0;
  let totalNarrowed = 0;
  let checked = 0;
  const examples: string[] = [];

  for (const candidate of full) {
    const a = findNearDuplicates(candidate, full, 50).map((m) => m.sku).sort();
    const narrowed = narrow(candidate, full);
    const b = findNearDuplicates(candidate, narrowed, 50).map((m) => m.sku).sort();
    totalNarrowed += narrowed.length;
    checked++;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      mismatches++;
      if (examples.length < 10)
        examples.push(`${candidate}\n    full: ${a.join(", ")}\n    narrow: ${b.join(", ")}`);
    }
  }

  console.log(`checked ${checked} candidates`);
  console.log(`average corpus after narrowing: ${Math.round(totalNarrowed / checked)} (was ${full.length})`);
  console.log(`reduction: ${(100 - (totalNarrowed / checked / full.length) * 100).toFixed(1)}%`);
  if (mismatches) {
    console.log(`\n!! ${mismatches} candidates lost a match:\n`);
    for (const e of examples) console.log("  " + e);
  } else {
    console.log("\nno match lost — narrowing is safe");
  }
  await prisma.$disconnect();
  process.exit(mismatches ? 1 : 0);
}
main();
