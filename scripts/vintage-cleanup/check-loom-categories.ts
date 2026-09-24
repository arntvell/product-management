// Build (not send) the Loom registry payload for a list of colourway ids and
// print the categories each would carry — the push route's dry-run preview does
// not show them.
//
//   npx dotenv -e .env.local -- npx tsx scripts/vintage-cleanup/check-loom-categories.ts <ids.json>
import { readFileSync } from "node:fs";
import { loadColorwaysForLoom, buildLoomPayloadFromColorways } from "@/lib/loom/payload";

async function main() {
  const ids: string[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const cws = await loadColorwaysForLoom(ids, "CONTINUITY");
  const payload = buildLoomPayloadFromColorways(cws, "CONTINUITY", new Set(), "check-only", "data");
  for (const s of payload.styles)
    for (const c of s.colorways)
      console.log(`${c.colorway_sku.padEnd(24)} ${String(c.name).padEnd(30)} style=${s.category}  product_type=${c.product_type}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
