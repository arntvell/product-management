// Dry run of POST /external-products for a JSON file of Loom buying lines.
// dry_run is forced true: nothing is written. Prints one TSV row per line.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner/dry-run-lines.ts <lines.json>
import { readFileSync } from "node:fs";
import { prisma } from "../../src/lib/db";
import { createExternalProducts, type ExternalProductItem } from "../../src/lib/partner/external-products";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: dry-run-lines.ts <lines.json>");
  const lines = JSON.parse(readFileSync(file, "utf8")) as (ExternalProductItem & { brand: { name?: string } })[];
  const { items } = await createExternalProducts({ dry_run: true, season: "SS27", items: lines });
  for (const [i, r] of items.entries()) {
    const l = lines[i];
    const label = `${l.brand.name}\t${l.style_name}\t${l.colour ?? ""}`;
    console.log(r.ok ? `${label}\tOK\t${r.colorway_sku}` : `${label}\tFAIL\t${r.error}`);
  }
}
main().finally(() => prisma.$disconnect());
