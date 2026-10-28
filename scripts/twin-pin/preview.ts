// Dry-run the Threadflow sync for every season a colorway is in, and show what
// it would do to that colorway. Writes nothing.
//   npx tsx scripts/twin-pin/preview.ts LIV-SRN-JPN-BLCK-DSK [more SKUs…]
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
async function main() {
  const skus = process.argv.slice(2);
  const { prisma } = await import("../../src/lib/db.ts");
  const { previewSeason } = await import("../../src/lib/threadflow/sync.ts");
  const cws = await prisma.colorway.findMany({
    where: { colorwaySku: { in: skus } },
    select: { id: true, colorwaySku: true, entries: { select: { season: { select: { code: true } } } } },
  });
  const seasons = [...new Set(cws.flatMap((c) => c.entries.map((e) => e.season.code)))].sort();
  const ids = new Set(cws.map((c) => c.id));
  const words = skus.flatMap((s) => [s, s.replace(/^LIV-/, "")]);
  console.log("seasons:", seasons.join(", "));
  for (const code of seasons) {
    let pv;
    try { pv = await previewSeason(code, "no-images"); }
    catch (e) { console.log(`\n${code}: Threadflow has no such season (${(e as Error).message})`); continue; }
    const renames = pv.renames.filter((r) => ids.has(r.colorwayId));
    const parks = pv.parks.filter((r) => ids.has(r.colorwayId));
    const skipped = pv.skipped.filter((s) => s.local && ids.has(s.local.id));
    const warn = pv.warnings.filter((w) => words.some((s) => w.includes(s)));
    console.log(`\n${code}: season-wide renames ${pv.renames.length}, variantCreates ${pv.planned.variantCreates}, colorwayCreates ${pv.planned.colorwayCreates}`);
    console.log(`  for these: renames ${renames.length}, parks ${parks.length}, skipped ${skipped.length}`);
    for (const r of [...renames, ...parks]) console.log("   ", r.from, "->", r.to);
    for (const w of warn) console.log("   warn:", w);
    for (const r of pv.renames) console.log("   season rename:", r.from, "->", r.to);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
