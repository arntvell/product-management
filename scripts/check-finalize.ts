// End-to-end check of the finalize path, against the real database.
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-finalize.ts
//
// Creates a throwaway brand, season entry and style, drives a draft through
// pre-flight and finalize, and asserts the three properties that matter:
//
//   1. a dry run writes nothing
//   2. finalize twice creates ONE set of rows (the claim mutex)
//   3. a draft left FINALIZING after a committed transaction resumes without
//      creating anything a second time
//
// Everything it makes is deleted at the end, including on failure.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { emptyDraftPayload, type DraftPayloadV1 } from "../src/lib/master/draft-payload.ts";
import { buildStyleSku, buildColorwaySku, buildVariantSku } from "../src/lib/master/sku.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

const TAG = "ZZTEST" + Date.now().toString(36).toUpperCase().slice(-5);
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
};

async function main() {
  // The libs read the singleton in src/lib/db.ts, so import them lazily after
  // the env is loaded.
  const { preflightPayload, finalizeDraft } = await import("../src/lib/master/finalize.ts");

  const brand = await prisma.brand.create({
    data: { name: `ZZ Test Brand ${TAG}`, isLivid: false, skuToken: TAG },
  });
  const season = await prisma.season.findFirstOrThrow({ where: { code: "CONTINUITY" } });

  const styleSku = buildStyleSku({ prefix: "EXT", brandToken: TAG, style: "Test Style" });
  const payload: DraftPayloadV1 = {
    ...emptyDraftPayload(),
    brand: { id: brand.id, name: brand.name, skuToken: TAG, isLivid: false },
    seasonId: season.id,
    // SHOPIFY and LOOM only. A SITOO draft is refused unless the brand is linked
    // to a Sitoo manufacturer and the category has a navigation id — checked on
    // its own below, rather than made a precondition of every assertion here.
    channels: ["SHOPIFY", "LOOM"],
    template: { ...emptyDraftPayload().template, category: "Footwear", countryOfOrigin: "Italy" },
    style: { mode: "new", styleName: "Test Style", styleSku, manualSku: false },
    colorways: ["Dark Brown", "Black"].map((name, ci) => {
      const cwSku = buildColorwaySku(styleSku, name);
      return {
        key: `cw${ci}`,
        name,
        color: name,
        swatchHex: null,
        colorwaySku: cwSku,
        manualSku: false,
        categoryId: null,
        category: null,
        kind: null,
        sizeSystemId: null,
        variants: ["41", "42", "9.5"].map((size, vi) => ({
          key: `cw${ci}v${vi}`,
          entryId: null,
          sizeLabel: size,
          dim1: size,
          dim2: null,
          skuToken: size,
          variantSku: buildVariantSku(cwSku, size),
          barcode: null,
          barcodeSource: null,
        })),
        prices: { COST: "889.00", MSRP: "2600.00" },
      };
    }),
  };

  const draft = await prisma.productDraft.create({
    data: { title: "test", payload: payload as unknown as object },
  });

  // --- 1. pre-flight passes on clean data ---
  const report = await preflightPayload(draft.id, payload);
  check("preflight passes", report.ok, report.errors.concat(report.collisions.map((c) => c.proposed)).join("; "));
  check("counts right", report.counts.colorways === 2 && report.counts.variants === 6 && report.counts.prices === 4,
    JSON.stringify(report.counts));
  check("warns about missing barcodes for Loom",
    report.warnings.some((w) => w.includes("no barcode")));

  // --- 1b. the Sitoo links are a pre-flight refusal, not a push-time surprise ---
  const sitooReport = await preflightPayload(draft.id, { ...payload, channels: ["SITOO"] });
  check("Sitoo without a linked brand is refused",
    !sitooReport.ok && sitooReport.errors.some((e) => e.includes("Sitoo manufacturer")),
    sitooReport.errors.join("; "));

  // --- 2. dry run writes nothing ---
  const before = await prisma.colorway.count();
  await finalizeDraft(draft.id, { dryRun: true });
  check("dry run wrote nothing", (await prisma.colorway.count()) === before);
  check("dry run left status DRAFT",
    (await prisma.productDraft.findUnique({ where: { id: draft.id } }))!.status === "DRAFT");

  // --- 3. finalize twice, concurrently: exactly one set of rows ---
  const [a, b] = await Promise.allSettled([
    finalizeDraft(draft.id),
    finalizeDraft(draft.id),
  ]);
  check("both finalize calls resolved",
    a.status === "fulfilled" && b.status === "fulfilled",
    [a, b].map((r) => (r.status === "rejected" ? String(r.reason) : "ok")).join(" / "));

  const styles = await prisma.style.findMany({ where: { brandId: brand.id } });
  const colorways = await prisma.colorway.findMany({ where: { brandId: brand.id } });
  const variants = await prisma.variant.count({
    where: { colorway: { brandId: brand.id } },
  });
  check("exactly 1 style", styles.length === 1, `got ${styles.length}`);
  check("exactly 2 colorways", colorways.length === 2, `got ${colorways.length}`);
  check("exactly 6 variants", variants === 6, `got ${variants}`);
  check("colorways nest under the one style",
    colorways.every((c) => c.styleId === styles[0].id));
  check("style SKU has no colour tokens", styles[0].styleSku === styleSku, styles[0].styleSku);

  const prices = await prisma.price.findMany({ where: { colorwayId: { in: colorways.map((c) => c.id) } } });
  check("4 prices, COST and MSRP", prices.length === 4 &&
    prices.filter((p) => p.priceType === "COST").length === 2, `got ${prices.length}`);

  const pubs = await prisma.channelPublication.findMany({
    where: { colorwayId: { in: colorways.map((c) => c.id) } },
  });
  check("6 publications, unpublished", pubs.length === 6 && pubs.every((p) => !p.published),
    `got ${pubs.length}`);

  const locks = await prisma.fieldOwner.findMany({
    where: { entityType: "colorway", entityId: { in: colorways.map((c) => c.id) }, field: "kind" },
  });
  check("kind locked against the classifier",
    locks.length === 2 && locks.every((l) => l.lockedAt !== null && l.authority === "origio:builder"));

  const done = await prisma.productDraft.findUnique({ where: { id: draft.id } });
  check("draft COMPLETED", done!.status === "COMPLETED", done!.status);

  // --- 4. resume: a draft left FINALIZING after a committed transaction ---
  await prisma.productDraft.update({
    where: { id: draft.id },
    data: { status: "FINALIZING", completedAt: null },
  });
  const resumed = await finalizeDraft(draft.id);
  check("resume reported as resumed", "resumed" in resumed && resumed.resumed === true);
  check("resume created nothing extra",
    (await prisma.colorway.count({ where: { brandId: brand.id } })) === 2);
  check("resume marked COMPLETED",
    (await prisma.productDraft.findUnique({ where: { id: draft.id } }))!.status === "COMPLETED");

  // --- 5. a second draft with the same SKUs must be refused, by name ---
  const dup = await prisma.productDraft.create({
    data: { title: "dup", payload: payload as unknown as object },
  });
  const dupReport = await preflightPayload(dup.id, payload);
  check("duplicate batch refused", !dupReport.ok);
  check("collision names the SKU",
    dupReport.collisions.some((c) => c.proposed === payload.colorways[0].colorwaySku),
    dupReport.collisions.map((c) => c.proposed).join(", "));

  // --- cleanup ---
  await prisma.productDraft.deleteMany({ where: { id: { in: [draft.id, dup.id] } } });
  await prisma.fieldOwner.deleteMany({
    where: { entityType: "colorway", entityId: { in: colorways.map((c) => c.id) } },
  });
  await prisma.colorway.deleteMany({ where: { brandId: brand.id } });
  await prisma.style.deleteMany({ where: { brandId: brand.id } });
  await prisma.brand.delete({ where: { id: brand.id } });
  check("cleaned up", (await prisma.colorway.count({ where: { brandId: brand.id } })) === 0);

  console.log(fail ? `\n${fail} FAILURES` : "\nall assertions passed");
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
