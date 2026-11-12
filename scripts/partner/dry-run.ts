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
      { loom_key: "p-draft", brand: { name: "Brand Nobody Has", sku_token: null }, style_name: "Dry Run Tee", colour: "Navy", sizes: ["S", "M"], msrp_nok: 499, cost_nok: 200 },
      { loom_key: "p-draft-taken", brand: { name: "Brand Nobody Has", sku_token: "PB" }, style_name: "Dry Run Tee", sizes: ["S"], msrp_nok: 499, cost_nok: 200 },
      { loom_key: "p-id", brand: { origio_brand_id: "cmwe0sbqe0002v77245kk545n", name: "whatever Loom calls it" }, style_name: "Dry Run Sneaker", colour: "Black", sizes: ["42"], msrp_nok: 1999, cost_nok: 800 },
      { loom_key: "p-cnvr", brand: { name: "Converse" }, style_name: "Dry Run Chuck", colour: "Off White", sizes: ["42"], msrp_nok: 1199, cost_nok: 500 },
    ],
  });
  console.log("EXTERNAL-PRODUCTS", JSON.stringify(products.items, null, 1));
  const real = await createExternalProducts({
    dry_run: false,
    season: "SS27",
    items: [{ loom_key: "p-real-unknown-brand", brand: { name: "Brand Nobody Has" }, style_name: "X", sizes: ["S"], msrp_nok: 1, cost_nok: 1 }],
  });
  console.log("REAL CALL, UNKNOWN BRAND (refused before any write)", JSON.stringify(real.items));

  // Evidence for external-products filing a product in its season.
  const done = await prisma.productDraft.findMany({
    where: { loomKey: { not: null }, status: "COMPLETED" },
    select: { loomKey: true, createdColorwayIds: true },
    take: 3,
  });
  for (const d of done) {
    const cw = await prisma.colorway.findUnique({
      where: { id: d.createdColorwayIds[0] },
      select: {
        colorwaySku: true,
        entries: { select: { season: { select: { code: true } }, origin: true, approvedForProduction: true, _count: { select: { variants: true } } } },
        prices: { select: { season: { select: { code: true } }, currency: true, priceType: true, amount: true } },
      },
    });
    console.log("LOOM-BORN", d.loomKey, JSON.stringify(cw));
  }
  const all = await prisma.colorway.findMany({ select: { colorwaySku: true } });
  const { normalizeSku } = await import("../../src/lib/master/sku");
  const odd = all.filter((c) => normalizeSku(c.colorwaySku) !== c.colorwaySku);
  console.log(`colourway SKUs not in normalised form: ${odd.length}`, odd.slice(0, 5).map((c) => c.colorwaySku));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
