// What token does each brand ACTUALLY use in its SKUs?
//
//   npx dotenv -e .env.local -- npx tsx scripts/brand-sku-tokens.ts
//
// Read-only by default. Pass --apply to write Brand.skuToken for every brand
// whose corpus is clear enough (see CONFIDENT_SHARE); the rest are listed for a
// person to decide, because the report cannot tell a convention from a typo.
//
// Brand.skuToken must be seeded from this, never guessed: a style
// SKU is never rewritten (roadmap 2.2), so a wrong token diverges that brand
// from its own history permanently. The report shows what the abbreviation rule
// would derive alongside what the corpus says, and flags every disagreement.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { buildStyleSku, skuTokens, MEANINGFUL_PREFIXES } from "../src/lib/master/sku.ts";

/**
 * How much of a brand's corpus must agree before the token is written without
 * asking. Below this the spellings are genuinely split — Subu is 31% SUBE with
 * SUKH, SUBL and SUNANB behind it — and picking the plurality would be a guess
 * dressed as a measurement.
 */
const CONFIDENT_SHARE = 0.7;

const APPLY = process.argv.includes("--apply");

const adapter = new PrismaPg({
  connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL,
});
const prisma = new PrismaClient({ adapter });

/** The token that sits between the owner prefix and the style. */
function brandSegment(sku: string): string | null {
  const t = skuTokens(sku);
  let i = 0;
  while (i < t.length && (MEANINGFUL_PREFIXES as readonly string[]).includes(t[i])) i++;
  if (t[i] !== "EXT") return null; // only external SKUs carry a brand segment
  return t[i + 1] ?? null;
}

async function main() {

const brands = await prisma.brand.findMany({
  where: { isLivid: false },
  select: {
    id: true,
    name: true,
    skuToken: true,
    colorways: { select: { colorwaySku: true }, take: 2000 },
  },
});

const rows: Array<{
  id: string;
  current: string | null;
  brand: string;
  rows: number;
  dominant: string | null;
  share: string;
  shareNum: number;
  derived: string;
  agrees: boolean;
  others: string;
}> = [];

for (const b of brands) {
  const counts = new Map<string, number>();
  for (const c of b.colorways) {
    const seg = brandSegment(c.colorwaySku);
    if (seg) counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, x) => x[1] - a[1]);
  const total = sorted.reduce((a, [, n]) => a + n, 0);
  const dominant = sorted[0]?.[0] ?? null;

  // What the rule alone would produce, with no token set.
  const derived = brandSegment(buildStyleSku({ prefix: "EXT", brandName: b.name, style: "X" }));

  rows.push({
    brand: b.name,
    rows: total,
    dominant,
    share: total ? `${Math.round(((sorted[0]?.[1] ?? 0) / total) * 100)}%` : "—",
    shareNum: total ? (sorted[0]?.[1] ?? 0) / total : 0,
    id: b.id,
    current: b.skuToken,
    derived: derived ?? "—",
    agrees: Boolean(dominant) && dominant === derived,
    others: sorted.slice(1, 4).map(([t, n]) => `${t}×${n}`).join(" "),
  });
}

const withSkus = rows.filter((r) => r.rows > 0).sort((a, b) => b.rows - a.rows);
const disagree = withSkus.filter((r) => !r.agrees);

console.log(`${brands.length} non-Livid brands, ${withSkus.length} with EXT- SKUs\n`);
console.log("brand".padEnd(28), "rows".padStart(6), "corpus".padEnd(10), "share".padStart(6), "rule".padEnd(10), "other spellings");
console.log("-".repeat(100));
for (const r of withSkus) {
  console.log(
    r.brand.slice(0, 27).padEnd(28),
    String(r.rows).padStart(6),
    (r.dominant ?? "—").padEnd(10),
    r.share.padStart(6),
    (r.agrees ? "=" : r.derived).padEnd(10),
    r.others
  );
}
console.log(
  `\n${disagree.length} of ${withSkus.length} brands need an explicit skuToken ` +
    `(the rule would change their spelling).`
);
console.log(
  `${withSkus.filter((r) => r.others).length} brands already use more than one spelling — ` +
    `pick the dominant one; the others are history and stay as they are.`
);

const confident = withSkus.filter((r) => r.dominant && r.shareNum >= CONFIDENT_SHARE);
const unclear = withSkus.filter((r) => r.dominant && r.shareNum < CONFIDENT_SHARE);

if (unclear.length) {
  console.log(`\nNeeds a person — the corpus is split below ${CONFIDENT_SHARE * 100}%:`);
  for (const r of unclear) {
    console.log(`  ${r.brand.padEnd(20)} ${r.dominant} ${r.share}   also ${r.others}`);
  }
}

if (!APPLY) {
  console.log(
    `\nDry run. --apply would set skuToken on ${confident.length} brand(s) and leave ${unclear.length} alone.`
  );
} else {
  let written = 0;
  for (const r of confident) {
    if (r.current === r.dominant) continue;
    await prisma.brand.update({ where: { id: r.id }, data: { skuToken: r.dominant } });
    written++;
  }
  console.log(`\nWrote skuToken on ${written} brand(s). ${unclear.length} left for a decision.`);
}

await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
