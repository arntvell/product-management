// Dry runs of the three partner calls Loom makes at plan lock, through the lib
// functions (no HTTP, no token). dry_run is forced true: nothing is written.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner/dry-run.ts
import { prisma } from "../../src/lib/db";
import { upsertPartnerBrands } from "../../src/lib/partner/brands";
import { assignToSeason } from "../../src/lib/partner/season-assignments";
import { createExternalProducts } from "../../src/lib/partner/external-products";

async function main() {
  const brands = await upsertPartnerBrands({
    dry_run: true,
    items: [
      { loom_key: "b-cnvr", name: "Converse" },
      { loom_key: "b-eyyt", name: "EYYTS", sku_token: "EYYT" },
      { loom_key: "b-bkst", name: "Birkenstock" },
      { loom_key: "b-dm", name: "Diemme" },
      { loom_key: "b-new", name: "Brand Nobody Has", supplier_name: "X", currency: "EUR" },
      { loom_key: "b-new2", name: "Brand Nobody Has" },
      { loom_key: "b-clash", name: "Totally New Paraboot", sku_token: "PB" },
      { loom_key: "b-livid", name: "Livid Two" },
    ],
  });
  console.log("BRANDS", JSON.stringify(brands.items, null, 1));

  const sample = await prisma.colorway.findMany({
    where: { brand: { isLivid: false }, status: "ACTIVE", archived: false, entries: { some: {} } },
    select: { colorwaySku: true },
    take: 2,
    orderBy: { updatedAt: "desc" },
  });
  const ss27 = await prisma.colorway.findFirst({
    where: { entries: { some: { season: { code: "SS27" } } } },
    select: { colorwaySku: true },
  });
  const livid = await prisma.colorway.findFirst({ where: { brand: { isLivid: true } }, select: { colorwaySku: true } });
  const archived = await prisma.colorway.findFirst({ where: { status: "ARCHIVED", brand: { isLivid: false } }, select: { colorwaySku: true } });
  const items = [
    ...sample.map((s, i) => ({ loom_key: `s-${i}`, colorway_sku: s.colorwaySku, msrp_nok: 2499, cost_nok: 1000 })),
    ...(ss27 ? [{ loom_key: "s-in", colorway_sku: ss27.colorwaySku, msrp_nok: 1999 }] : []),
    { loom_key: "s-livid", colorway_sku: livid!.colorwaySku, msrp_nok: 1500 },
    ...(archived ? [{ loom_key: "s-arch", colorway_sku: archived.colorwaySku, msrp_nok: 1500 }] : []),
    { loom_key: "s-none", colorway_sku: "EXT-NOPE-NOTHING", msrp_nok: 1500 },
    { loom_key: "s-bad", colorway_sku: sample[0].colorwaySku, msrp_nok: 0 },
  ];
  const seasons = await assignToSeason({ dry_run: true, season: "ss27", items });
  console.log("SEASON-ASSIGNMENTS", JSON.stringify(seasons.items, null, 1));
  for (const bad of ["CONTINUITY", "XX99"])
    await assignToSeason({ dry_run: true, season: bad, items: [] }).catch((e) => console.log(`season ${bad}:`, e.message));

  const products = await createExternalProducts({
    dry_run: true,
    season: "SS27",
    items: [
      { loom_key: "p-dm", brand: { name: "Diemme" }, style_name: "Dry Run Boot", colour: "Black", sizes: ["41", "42"], msrp_nok: 3999, cost_nok: 1600 },
      { loom_key: "p-cnvr", brand: { name: "Converse" }, style_name: "Dry Run Chuck", colour: "Off White", sizes: ["42"], msrp_nok: 1199, cost_nok: 500 },
    ],
  });
  console.log("EXTERNAL-PRODUCTS", JSON.stringify(products.items, null, 1));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
