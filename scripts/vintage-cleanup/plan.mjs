// Plan the vintage product cleanup from the marked-up Loom export.
//
// The input is `products-2026-09-23.xlsx`, exported from Loom and marked up by
// hand: rows filled red are legacy products to archive, and the two blue columns
// (Colorway name, Category) carry the new values. Vintage store products are
// one-size, one-colourway styles, so the style takes the colourway's name.
//
// READ ONLY. Reads the sheet, the master and Sitoo production, and writes a plan
// that apply-origio.mjs, push-loom.mjs and sitoo.mjs execute. Nothing here writes.
//
//   node scripts/vintage-cleanup/plan.mjs --xlsx="<path>" [--out=snapshots/vintage-cleanup-plan.json]
//
// Three rules came from Kristoffer on 2026-09-24 and are encoded below:
//  - A red row with stock in Sitoo is HELD, not archived: Loom will not withdraw a
//    stocked SKU and an inactive Sitoo product cannot be rung up.
//  - The sheet's title case wins, except abbreviations, which keep their capitals
//    (the sheet's PROPER() turned "RL Chino" into "Rl Chino").
//  - SKUs are never changed. The sheet's style number for the Selected Kimono was
//    caught by a find-and-replace on "Johanne"; only names and categories apply.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const XLSX = arg("xlsx");
const OUT = arg("out") ?? "snapshots/vintage-cleanup-plan.json";
if (!XLSX) {
  console.error('Usage: plan.mjs --xlsx="<path to marked-up export>"');
  process.exit(1);
}

const RED = "FFF4CCCC";

// Abbreviations keep their capitals whatever the sheet says. Matched per token,
// case-insensitively.
const ABBREVIATIONS = ["US", "RL", "LLW", "XL", "Y2K", "OG-107"];
// Mixed-case tokens that are names, not words: restore exactly as the master had them.
const KEEP_AS_WRITTEN = ["PiP"];

export function fixName(sheetName) {
  const trimmed = String(sheetName ?? "").replace(/\s+/g, " ").trim();
  return trimmed.replace(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g, (tok) => {
    const abbr = ABBREVIATIONS.find((a) => a.toLowerCase() === tok.toLowerCase());
    if (abbr) return abbr;
    const kept = KEEP_AS_WRITTEN.find((a) => a.toLowerCase() === tok.toLowerCase());
    return kept ?? tok;
  });
}

// ---- 1. the sheet ----------------------------------------------------------
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);
const ws = wb.worksheets[0];
const header = ws.getRow(1).values.slice(1).map((v) => String(v ?? "").trim());
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Column "${name}" not in sheet`);
  return i + 1;
};
const C = {
  style: col("Style name"),
  styleSku: col("Style number"),
  cwName: col("Colorway name"),
  cwSku: col("Colorway SKU"),
  sku: col("SKU"),
  barcode: col("Barcode"),
  category: col("Category"),
};
const sheet = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  const text = (c) => {
    const v = row.getCell(c).value;
    return v == null ? null : String(typeof v === "object" && "result" in v ? v.result : v);
  };
  let red = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.fill?.type === "pattern" && cell.fill.fgColor?.argb === RED) red = true;
  });
  sheet.push({
    row: n,
    red,
    styleName: text(C.style),
    styleSku: text(C.styleSku),
    colorwayName: text(C.cwName),
    colorwaySku: text(C.cwSku),
    sku: text(C.sku),
    barcode: text(C.barcode),
    category: text(C.category)?.trim(),
  });
});

// ---- 2. the master ---------------------------------------------------------
const db = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await db.connect();
await db.query("SET default_transaction_read_only = on");

const { rows: master } = await db.query(
  `select v."variantSku" sku, v.barcode, c.id "colorwayId", c."colorwaySku", c.name, c."productType",
          c."categoryId", c.status, c.archived, c.vendor, s.id "styleId", s."styleSku", s."styleName",
          s.category "styleCategory", s."categoryId" "styleCategoryId",
          (select count(*)::int from "Colorway" x where x."styleId" = s.id) "styleColorways"
     from "Variant" v join "Colorway" c on c.id = v."colorwayId" join "Style" s on s.id = c."styleId"
    where v."variantSku" = any($1)`,
  [sheet.map((r) => r.sku)]
);
const { rows: categories } = await db.query(
  `select id, slug, name, "sitooCategoryId", "loomCategory", "shopifyProductType", archived, "mergedIntoId"
     from "Category"`
);
await db.end();

const bySku = new Map(master.map((m) => [m.sku, m]));
const catBySlug = new Map(categories.map((c) => [c.slug, c]));
// Same as categorySlug in src/lib/master/reference-pull.ts, which Category.slug is keyed on.
const slug = (raw) =>
  raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uncategorized";

// ---- 3. Sitoo production (read only) --------------------------------------
const sitooBase = process.env.SITOO_BASE_URL.replace(/\/+$/, "");
const sitooAuth =
  "Basic " + Buffer.from(`${process.env.SITOO_API_ID}:${process.env.SITOO_API_KEY}`).toString("base64");
async function sitoo(path) {
  const res = await fetch(`${sitooBase}/sites/1${path}`, { headers: { Authorization: sitooAuth } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sitoo GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function sitooAll(path) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await sitoo(`${path}${sep}start=${start}&num=1000`);
    out.push(...(page.items ?? []));
    if ((page.items ?? []).length < 1000) break;
  }
  return out;
}
const sitooProducts = await sitooAll("/products?includeinactive=true");
const sitooBySku = new Map(sitooProducts.map((p) => [p.sku.toUpperCase(), p]));
const sitooCategories = await sitooAll("/categories");
const sitooCatByTitle = new Map(sitooCategories.map((c) => [c.title.toLowerCase(), c]));

const wanted = new Set(sheet.map((r) => r.sku.toUpperCase()));
const stock = new Map(); // SKU -> { warehouse: qty }
for (const w of await sitooAll("/warehouses")) {
  for (const it of await sitooAll(`/warehouses/${w.warehouseid}/warehouseitems?fields=sku,decimaltotal`)) {
    const k = it.sku?.toUpperCase();
    if (!k || !wanted.has(k) || Number(it.decimaltotal) === 0) continue;
    stock.set(k, { ...(stock.get(k) ?? {}), [w.name]: Number(it.decimaltotal) });
  }
}

// ---- 4. the plan -----------------------------------------------------------
const problems = [];
const colorways = new Map();
for (const r of sheet) {
  const m = bySku.get(r.sku);
  if (!m) {
    problems.push(`row ${r.row}: ${r.sku} is not in the master`);
    continue;
  }
  if (m.barcode !== r.barcode) problems.push(`row ${r.row}: barcode ${r.barcode} ≠ master ${m.barcode}`);
  if (m.styleSku !== r.styleSku)
    problems.push(`row ${r.row}: sheet style number ${r.styleSku} ≠ master ${m.styleSku} — ignored, SKUs are not changed`);
  if (m.styleColorways !== 1)
    problems.push(`row ${r.row}: style ${m.styleSku} has ${m.styleColorways} colourways — style rename would hit its siblings`);

  const sp = sitooBySku.get(r.sku.toUpperCase()) ?? null;
  const variant = {
    row: r.row,
    sku: r.sku,
    sitooProductId: sp?.productid ?? null,
    sitooTitle: sp?.title ?? null,
    sitooActive: sp ? { active: sp.active, activepos: sp.activepos } : null,
    sitooStock: stock.get(r.sku.toUpperCase()) ?? {},
  };

  let cw = colorways.get(m.colorwayId);
  if (!cw) {
    cw = {
      colorwayId: m.colorwayId,
      colorwaySku: m.colorwaySku,
      styleId: m.styleId,
      styleSku: m.styleSku,
      rows: [],
      red: [],
      from: {
        name: m.name,
        styleName: m.styleName,
        productType: m.productType,
        styleCategory: m.styleCategory,
        categoryId: m.categoryId,
        styleCategoryId: m.styleCategoryId,
        status: m.status,
        archived: m.archived,
      },
      sheetName: r.colorwayName,
      category: r.category,
      variants: [],
    };
    colorways.set(m.colorwayId, cw);
  }
  cw.rows.push(r.row);
  cw.red.push(r.red);
  cw.variants.push(variant);
  if (cw.sheetName !== r.colorwayName || cw.category !== r.category)
    problems.push(`row ${r.row}: ${m.colorwaySku} has conflicting name/category across its rows`);
}

const newCategories = new Map();
const plan = [];
for (const cw of colorways.values()) {
  if (new Set(cw.red).size > 1) problems.push(`${cw.colorwaySku}: some rows red, some not`);
  const red = cw.red[0];
  // Only stock on a LIVE Sitoo product holds an archive. Five red SKUs carry
  // 2022–23 stock rows in Sitoo warehouses for products Sitoo no longer has:
  // nothing can sell them and there is nothing to deactivate, so they archive,
  // and the rows are recorded as orphanStock for whoever writes stock off.
  const stocked = cw.variants.filter((v) => v.sitooProductId && Object.keys(v.sitooStock).length > 0);
  const orphanStock = cw.variants.filter((v) => !v.sitooProductId && Object.keys(v.sitooStock).length > 0);

  const name = fixName(cw.sheetName);
  const catSlug = slug(cw.category);
  const existing = catBySlug.get(catSlug);
  if (existing?.archived || existing?.mergedIntoId)
    problems.push(`${cw.colorwaySku}: category ${cw.category} is archived/merged in the master`);
  if (!existing) newCategories.set(catSlug, cw.category);

  const sitooCat = existing?.sitooCategoryId ?? sitooCatByTitle.get(cw.category.toLowerCase())?.categoryid ?? null;

  plan.push({
    ...cw,
    red: undefined,
    to: {
      name,
      styleName: name,
      category: existing?.name ?? cw.category,
      categorySlug: catSlug,
      categoryId: existing?.id ?? null, // null → created by apply-origio.mjs
      sitooCategoryId: sitooCat == null ? null : String(sitooCat),
    },
    changes: {
      name: name !== cw.from.name,
      styleName: name !== cw.from.styleName,
      category:
        (existing?.name ?? cw.category) !== cw.from.productType ||
        (existing?.name ?? cw.category) !== cw.from.styleCategory ||
        (existing?.id ?? null) !== cw.from.categoryId ||
        (existing?.id ?? null) !== cw.from.styleCategoryId,
    },
    action: !red ? "update" : stocked.length ? "hold" : "archive",
    orphanStock: orphanStock.map((v) => ({ sku: v.sku, stock: v.sitooStock })),
  });
}

const count = (f) => plan.filter(f).length;
const summary = {
  sheetRows: sheet.length,
  colorways: plan.length,
  archive: count((p) => p.action === "archive"),
  hold: count((p) => p.action === "hold"),
  renamed: count((p) => p.changes.name || p.changes.styleName),
  recategorised: count((p) => p.changes.category),
  unchanged: count((p) => !p.changes.name && !p.changes.styleName && !p.changes.category && p.action === "update"),
  inSitoo: plan.reduce((n, p) => n + p.variants.filter((v) => v.sitooProductId).length, 0),
  newCategories: [...newCategories.values()],
  problems: problems.length,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), source: XLSX, summary, problems, newCategories: [...newCategories.entries()].map(([slug, name]) => ({ slug, name, sitooCategoryId: sitooCatByTitle.get(name.toLowerCase())?.categoryid ?? null })), plan }, null, 2)
);
console.log(JSON.stringify(summary, null, 2));
for (const p of problems) console.log("  !", p);
console.log(`Plan → ${OUT}`);
