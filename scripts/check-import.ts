// Round-trip check of the bulk importer, against the real database.
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-import.ts
//   npx dotenv -e .env.local -- npx tsx scripts/check-import.ts --commit
//
// WITHOUT --commit it writes NOTHING. It reads a real brand, season and size
// system, builds the template those choices produce, fills it in memory the way
// a person would, and parses it back — which exercises everything that can be
// wrong about the file format and the regrouping:
//
//   the hidden Meta sheet round-trips brand / season / kind / size system
//   an EAN-13 survives Excel as thirteen digits rather than 7.07254E+12
//   one row per size regroups into style -> colourway -> variants
//   a size outside the system is refused, not invented
//   two prices for one colourway is refused, not "first one wins"
//   the same barcode twice in one file is caught HERE, because per-draft
//     pre-flight compares against the master and would miss it
//   a category per LINE lands as a per-colourway override
//
// WITH --commit it also creates a throwaway brand, imports into real drafts,
// asserts the payloads, and deletes everything it made — including on failure.

import { PrismaPg } from "@prisma/adapter-pg";
import ExcelJS from "exceljs";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  buildImportTemplate,
  COL,
  HEADER_ROW,
  SHEET_META,
  SHEET_PRODUCTS,
} from "../src/lib/master/import-template.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

const COMMIT = process.argv.includes("--commit");
const TAG = "ZZIMP" + Date.now().toString(36).toUpperCase().slice(-5);

let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
};

type Row = [string, string, string, string, string, string, string];

/** Fill a generated template the way a person would, and hand back the bytes. */
async function fill(body: Buffer, rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(SHEET_PRODUCTS)!;
  rows.forEach((r, i) => {
    const n = HEADER_ROW + 1 + i;
    ws.getCell(n, COL.style).value = r[0];
    ws.getCell(n, COL.colorway).value = r[1];
    ws.getCell(n, COL.size).value = r[2];
    if (r[3]) ws.getCell(n, COL.priceIn).value = Number(r[3]);
    if (r[4]) ws.getCell(n, COL.priceOut).value = Number(r[4]);
    // Deliberately as a NUMBER. That is what Excel does to a barcode typed into
    // a cell whose format was lost, and it is the case String(cell.value) gets
    // wrong — so the parser is tested against the hostile shape, not the easy one.
    if (r[5]) ws.getCell(n, COL.barcode).value = Number(r[5]);
    if (r[6]) ws.getCell(n, COL.category).value = r[6];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  const { parseImportWorkbook, commitImport } = await import(
    "../src/lib/master/import-products.ts"
  );
  const { listSizeSystems } = await import("../src/lib/master/size-systems.ts");

  // The parser reads the size system, brand and season back from the DATABASE
  // by the ids in the file's Meta sheet — that is the whole point of the Meta
  // sheet — so a full round-trip needs rows to exist. Without --commit the run
  // stops after the template assertions rather than creating any.
  const season = await prisma.season.findFirstOrThrow({ where: { code: "CONTINUITY" } });
  const existingSystems = await listSizeSystems();
  const reusable = existingSystems.find(
    (s) => !s.archived && s.entries.filter((e) => !e.archived).length >= 2
  );

  let system = reusable ?? null;
  let brand = reusable
    ? await prisma.brand.findFirstOrThrow({ where: { isLivid: false, archived: false } })
    : null;
  let madeSystemId: string | null = null;

  if (COMMIT || !system) {
    if (!COMMIT) {
      console.log(
        "\nNo size system in the database with two active sizes, so the parse round-trip " +
          "needs one created. Re-run with --commit to create a throwaway brand and size " +
          "system (both deleted at the end). Running the template assertions only.\n"
      );
    } else {
      const { createSizeSystem } = await import("../src/lib/master/size-systems.ts");
      madeSystemId = await createSizeSystem({
        name: `ZZ Import sizes ${TAG}`,
        kind: "ONE_D",
        entries: [{ dim1: "S" }, { dim1: "M" }, { dim1: "L" }],
      });
      system = (await listSizeSystems()).find((s) => s.id === madeSystemId)!;
      brand = await prisma.brand.create({
        data: { name: `ZZ Import ${TAG}`, isLivid: false, skuToken: TAG },
      });
    }
  }

  const category = await prisma.category.findFirst({ where: { archived: false, active: true } });
  const templateSystem =
    system ??
    // A stand-in purely for the template assertions, which never touch the DB.
    ({
      id: "fixture",
      name: "Fixture sizes",
      kind: "ONE_D" as const,
      note: null,
      archived: false,
      brands: [],
      entries: ["S", "M", "L"].map((label, i) => ({
        id: `fixture-${i}`,
        sizeLabel: label,
        dim1: label,
        dim2: null,
        skuToken: label,
        position: i,
        archived: false,
      })),
    });
  const sizes = templateSystem.entries.filter((e) => !e.archived);

  console.log(
    `brand ${brand?.name ?? "(none)"} · season ${season.code} · sizes ${templateSystem.name} ` +
      `(${sizes.length})` + (COMMIT ? " · COMMITTING" : " · read-only")
  );

  try {
    // --- the template -------------------------------------------------------
    const { filename, body } = await buildImportTemplate({
      brandId: brand?.id ?? "fixture",
      brandName: brand?.name ?? "Fixture Brand",
      seasonId: season.id,
      seasonCode: season.code,
      kind: "MERCHANDISE",
      sizeSystem: templateSystem,
    });
    check("template built", body.length > 4000, `${filename}, ${body.length} bytes`);

    const probe = new ExcelJS.Workbook();
    await probe.xlsx.load(body as unknown as ArrayBuffer);
    check("Meta sheet is hidden", probe.getWorksheet(SHEET_META)?.state === "veryHidden");
    const cell = probe.getWorksheet(SHEET_PRODUCTS)!.getCell(HEADER_ROW + 1, COL.size);
    check(
      "size validation points at a RANGE, not an inline list",
      // An inline list caps at 255 characters and Excel drops it silently; a
      // range reference has no such limit.
      /^Sizes!\$A\$1:\$A\$\d+$/.test(String(cell.dataValidation?.formulae?.[0] ?? "")),
      String(cell.dataValidation?.formulae?.[0] ?? "none")
    );
    check(
      "barcode column is text-formatted",
      probe.getWorksheet(SHEET_PRODUCTS)!.getCell(HEADER_ROW + 1, COL.barcode).numFmt === "@"
    );

    if (!system || !brand) {
      console.log(fail ? `\n${fail} FAILURES` : "\ntemplate assertions passed");
      await prisma.$disconnect();
      process.exit(fail ? 1 : 0);
    }

    const catName = category?.name ?? "Uncategorized";
    const s0 = sizes[0].sizeLabel;
    const s1 = sizes[1].sizeLabel;

    // --- the happy path -----------------------------------------------------
    const good = await fill(body, [
      ["Test Boot", "Dark Brown", s0, "400", "1999", "7072536000017", catName],
      ["Test Boot", "Dark Brown", s1, "400", "1999", "7072536000024", catName],
      ["Test Boot", "Black", s0, "400", "1999", "", catName],
      ["Test Bag", "Tan", s0, "250", "1299", "", catName],
    ]);
    const ok = await parseImportWorkbook(good);
    check("context recovered from the file", ok.context.brandId === brand.id && ok.context.seasonId === season.id);
    check("no errors on a clean file", ok.ok, ok.errors.join(" | "));
    check("two styles", ok.counts.styles === 2, String(ok.counts.styles));
    check("three colourways", ok.counts.colorways === 3, String(ok.counts.colorways));
    check("four sizes", ok.counts.variants === 4, String(ok.counts.variants));

    const boot = ok.styles.find((s) => s.styleName === "Test Boot")!;
    const brown = boot.colorways.find((c) => c.name === "Dark Brown")!;
    check(
      "barcode survived Excel as 13 digits",
      brown.variants[0].barcode === "7072536000017",
      String(brown.variants[0].barcode)
    );
    check("price out read", brown.priceOut === "1999", String(brown.priceOut));
    check(
      "variant SKU is colourway + size token",
      brown.variants[0].variantSku === `${brown.colorwaySku}-${sizes[0].skuToken}`.toUpperCase(),
      brown.variants[0].variantSku
    );
    check(
      "unbarcoded size is a warning, not an error",
      ok.warnings.some((w) => /no barcode/.test(w))
    );

    // --- the refusals -------------------------------------------------------
    const badSize = await fill(body, [["Test Boot", "Dark Brown", "NOT-A-SIZE", "", "1999", "", catName]]);
    const r1 = await parseImportWorkbook(badSize);
    check("a size outside the system is refused", !r1.ok && r1.errors.some((e) => /not an active size/.test(e)));

    const twoPrices = await fill(body, [
      ["Test Boot", "Dark Brown", s0, "400", "1999", "", catName],
      ["Test Boot", "Dark Brown", s1, "400", "2099", "", catName],
    ]);
    const r2 = await parseImportWorkbook(twoPrices);
    check("two prices for one colourway refused", !r2.ok && r2.errors.some((e) => /price out/.test(e)));

    const dupBarcode = await fill(body, [
      ["Test Boot", "Dark Brown", s0, "", "1999", "7072536000017", catName],
      ["Test Bag", "Tan", s0, "", "1299", "7072536000017", catName],
    ]);
    const r3 = await parseImportWorkbook(dupBarcode);
    check(
      "the same barcode on two STYLES is caught in the file",
      !r3.ok && r3.errors.some((e) => /is on row/.test(e)),
      r3.errors.join(" | ")
    );

    const dupSize = await fill(body, [
      ["Test Boot", "Dark Brown", s0, "", "1999", "", catName],
      ["Test Boot", "Dark Brown", s0, "", "1999", "", catName],
    ]);
    const r4 = await parseImportWorkbook(dupSize);
    check("the same size twice in one colourway refused", !r4.ok && r4.errors.some((e) => /twice/.test(e)));

    // 7072536000019 — the right stem, the wrong final digit (it should be 7).
    const badBarcode = await fill(body, [["Test Boot", "Dark Brown", s0, "", "1999", "7072536000019", catName]]);
    const r5 = await parseImportWorkbook(badBarcode);
    check("a bad check digit is refused", !r5.ok, r5.errors.join(" | "));

    const noCategory = await fill(body, [["Test Boot", "Dark Brown", s0, "", "1999", "", ""]]);
    const r6 = await parseImportWorkbook(noCategory);
    check("a colourway with no category is refused", !r6.ok && r6.errors.some((e) => /No category/.test(e)));

    const unknownCategory = await fill(body, [
      ["Test Boot", "Dark Brown", s0, "", "1999", "", `ZZ Nonexistent ${TAG}`],
    ]);
    const r7 = await parseImportWorkbook(unknownCategory);
    check(
      "an unknown category is a DECISION, not an error",
      r7.ok && r7.categories.some((c) => !c.matchedId),
      r7.errors.join(" | ")
    );

    // --- commit -------------------------------------------------------------
    if (COMMIT) {
      if (!category) throw new Error("No category in the master to import against.");
      const res = await commitImport(ok, { channels: ["SHOPIFY"], decisions: [] });
      check("one draft per style", res.drafts.length === 2, String(res.drafts.length));

      const drafts = await prisma.productDraft.findMany({
        where: { id: { in: res.drafts.map((d) => d.id) } },
      });
      check("drafts open on review", drafts.every((d) => d.step === "review"));
      check("drafts carry the brand and season", drafts.every((d) => d.brandId === brand.id && d.seasonId === season.id));
      const bootDraft = drafts.find((d) => (d.payload as { style?: { styleName?: string } }).style?.styleName === "Test Boot");
      const p = bootDraft!.payload as {
        colorways: Array<{ variants: unknown[]; prices: Record<string, string> }>;
        template: { categoryId: string; defaultSizeSystemId: string };
      };
      check("payload has both colourways", p.colorways.length === 2);
      check("payload carries the category", p.template.categoryId === category.id, p.template.categoryId);
      check("payload carries the size system", p.template.defaultSizeSystemId === system.id);
      check("prices landed as COST/MSRP", p.colorways[0].prices.MSRP === "1999" && p.colorways[0].prices.COST === "400");

      await prisma.productDraft.deleteMany({ where: { id: { in: res.drafts.map((d) => d.id) } } });
      for (const c of res.createdCategories) await prisma.category.delete({ where: { id: c.id } });
    }
  } finally {
    if (COMMIT && brand) {
      await prisma.productDraft.deleteMany({ where: { brandId: brand.id } });
      await prisma.brand.delete({ where: { id: brand.id } }).catch(() => {});
      if (madeSystemId)
        await prisma.sizeSystem.delete({ where: { id: madeSystemId } }).catch(() => {});
      check("cleaned up", (await prisma.brand.count({ where: { id: brand.id } })) === 0);
    }
  }

  console.log(fail ? `\n${fail} FAILURES` : "\nall assertions passed");
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
