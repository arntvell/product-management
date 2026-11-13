// Dry runs of POST colorway-sizes through the lib function (no HTTP, no token).
// dry_run is forced true: nothing is written. Also prints the FeedStyle a real
// call would return for the first colourway, built without adding anything.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner/dry-run-sizes.ts
import { prisma } from "../../src/lib/db";
import { addColorwaySizes, prismaStore, sizesFeedStyle } from "../../src/lib/partner/colorway-sizes";

async function main() {
  const chambord = await prisma.colorway.findFirst({
    where: { brand: { name: "Paraboot" }, style: { styleName: { contains: "Chambord", mode: "insensitive" } }, status: { not: "ARCHIVED" }, archived: false },
    orderBy: { variants: { _count: "desc" } },
    select: { id: true, colorwaySku: true, variants: { select: { sizeLabel: true } } },
  });
  const jeans = await prisma.colorway.findFirst({
    where: { status: "ACTIVE", archived: false, brand: { isLivid: false }, variants: { some: { AND: [{ dim2: { not: null } }, { dim2: { not: "" } }] } } },
    select: { colorwaySku: true },
  });
  const livid = await prisma.colorway.findFirst({ where: { brand: { isLivid: true } }, select: { colorwaySku: true } });
  const archived = await prisma.colorway.findFirst({ where: { status: "ARCHIVED", brand: { isLivid: false } }, select: { colorwaySku: true } });
  console.log("CHAMBORD", chambord?.colorwaySku, chambord?.variants.map((v) => v.sizeLabel).join(" "));
  if (!chambord) throw new Error("no live Paraboot Chambord colourway");
  const have = chambord.variants[0]?.sizeLabel ?? "42";

  const r = await addColorwaySizes({
    dry_run: true,
    season: "SS27",
    items: [
      { loom_key: "z-46", colorway_sku: chambord.colorwaySku, sizes: ["46"], cost_nok: 2343.2, msrp_nok: 6900 },
      { loom_key: "z-have", colorway_sku: chambord.colorwaySku, sizes: [have, "46"], cost_nok: 1, msrp_nok: 1 },
      { loom_key: "z-adhoc", colorway_sku: chambord.colorwaySku, sizes: ["12", "6.5"], cost_nok: 1, msrp_nok: 1 },
      { loom_key: "z-lower", colorway_sku: chambord.colorwaySku.toLowerCase(), sizes: ["46"], cost_nok: 1, msrp_nok: 1 },
      ...(jeans ? [{ loom_key: "z-2d", colorway_sku: jeans.colorwaySku, sizes: ["33"], cost_nok: 1, msrp_nok: 1 }] : []),
      ...(livid ? [{ loom_key: "z-livid", colorway_sku: livid.colorwaySku, sizes: ["M"], cost_nok: 1, msrp_nok: 1 }] : []),
      ...(archived ? [{ loom_key: "z-arch", colorway_sku: archived.colorwaySku, sizes: ["M"], cost_nok: 1, msrp_nok: 1 }] : []),
      { loom_key: "z-none", colorway_sku: "EXT-NOPE-NOTHING", sizes: ["46"], cost_nok: 1, msrp_nok: 1 },
    ],
  });
  console.log("COLORWAY-SIZES", JSON.stringify(r.items, null, 1));
  await addColorwaySizes({ dry_run: true, season: "XX99", items: [] }).catch((e) => console.log("season XX99:", e.message));

  for (const season of [null, "SS27"]) {
    const style = sizesFeedStyle(await prismaStore.loadForFeed(chambord.id, season), season);
    const c = (style as { colorways: Array<Record<string, unknown>> }).colorways[0];
    console.log(
      `STYLE (season ${season ?? "none"})`,
      JSON.stringify({ ...style, colorways: [{ ...c, variants: (c.variants as unknown[]).length }] }, null, 1)
    );
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
