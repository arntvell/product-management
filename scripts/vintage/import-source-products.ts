// Import the buying sheet's `Lagerliste` into VintageSourceProduct.
//
//   npx dotenv -e .env.local -- npx tsx scripts/vintage/import-source-products.ts <file.xlsx>
//   ... --apply     to write; dry by default
//
// Two sheets are joined:
//   Lagerliste          Product | SKU | Category | Retail | Average cost
//   KATEGORI TIL NETT   Kategori kasse -> Kategori nett
//
// `Product` and `Kategori kasse` are the same vocabulary — the buyer's name for
// a kind of garment — which is what an online item's "Opprinnelig produkt"
// points at. Joining them gives one row carrying both the economics and the
// customer-facing category.
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";

// Minimal xlsx reader: the workbook is 4MB and we want five columns from two
// sheets, so pulling in a parser for it is not worth the dependency.
import { execFileSync } from "node:child_process";

interface Row {
  name: string;
  sku: string | null;
  category: string | null;
  webCategory: string | null;
  retailNok: string | null;
  costNok: string | null;
}

function readSheets(file: string): Row[] {
  const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)

nett = {}
for r in wb['KATEGORI TIL NETT'].iter_rows(min_row=2, values_only=True):
    r = list(r) + [None, None]
    if r[0] and r[1]:
        nett[str(r[0]).strip().lower()] = str(r[1]).strip()

out = []
seen = set()
for r in wb['Lagerliste'].iter_rows(min_row=2, values_only=True):
    r = list(r) + [None] * 5
    if not r[0]:
        continue
    name = str(r[0]).strip()
    key = name.lower()
    if key in seen:
        continue
    seen.add(key)
    out.append({
        "name": name,
        "sku": str(r[1]).strip() if r[1] else None,
        "category": str(r[2]).strip() if r[2] else None,
        "webCategory": nett.get(key),
        "retailNok": None if r[3] in (None, "") else str(r[3]),
        "costNok": None if r[4] in (None, "") else str(r[4]),
    })
print(json.dumps(out))
`;
  const stdout = execFileSync("python3", ["-c", py, file], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  return JSON.parse(stdout) as Row[];
}

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!file) throw new Error("Pass the workbook path.");
  readFileSync(file); // fail early and clearly if it is not there

  const rows = readSheets(file);
  const withRetail = rows.filter((r) => r.retailNok).length;
  const withCost = rows.filter((r) => r.costNok).length;
  const withWeb = rows.filter((r) => r.webCategory).length;
  console.log(`${rows.length} source products`);
  console.log(`  with a retail price : ${withRetail}`);
  console.log(`  with an average cost: ${withCost}`);
  console.log(`  mapped to a web category: ${withWeb}`);

  const skus = rows.map((r) => r.sku).filter((s): s is string => !!s);
  const inMaster = await prisma.colorway.count({ where: { colorwaySku: { in: skus } } });
  console.log(`  whose SKU is a colorway in the master: ${inMaster} of ${skus.length}`);

  const existing = await prisma.vintageSourceProduct.count();
  console.log(`\nalready stored: ${existing}`);

  if (!apply) {
    console.log("\nDry run. Pass --apply to write.");
    for (const r of rows.slice(0, 5))
      console.log(
        `  ${r.name.padEnd(32)} ${(r.sku ?? "-").padEnd(22)} ${(r.category ?? "-").padEnd(12)} ` +
          `${(r.webCategory ?? "-").padEnd(20)} retail ${r.retailNok ?? "-"}  cost ${r.costNok ?? "-"}`
      );
    return;
  }

  // Upsert by name: re-running after the buyer edits the sheet updates prices
  // rather than duplicating, and a row that disappears is left alone rather
  // than deleted — an online garment may still point at it.
  let written = 0;
  for (const r of rows) {
    await prisma.vintageSourceProduct.upsert({
      where: { name: r.name },
      create: {
        name: r.name,
        sku: r.sku,
        category: r.category,
        webCategory: r.webCategory,
        retailNok: r.retailNok,
        costNok: r.costNok,
      },
      update: {
        sku: r.sku,
        category: r.category,
        webCategory: r.webCategory,
        retailNok: r.retailNok,
        costNok: r.costNok,
      },
    });
    written++;
  }
  console.log(`\nWrote ${written}.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
