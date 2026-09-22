// The Excel workbook the bulk importer hands out, and the context it carries.
//
// WHY A GENERATED FILE RATHER THAN "HERE IS THE COLUMN ORDER"
//
// A blank spreadsheet is a free-text field with gridlines. Everything this
// builder spent its schema on — one controlled size run per product, a category
// vocabulary, a season, a product kind — is re-openable the moment a person
// types a size by hand. So the file is generated per batch with the choices
// ALREADY MADE, and the only open cells are the seven the operator actually
// knows: style, colourway, size, the two prices, barcode, category.
//
// THREE THINGS THAT ARE LOAD-BEARING IN THE FILE FORMAT
//
//   1. Size validation points at a hidden sheet, never an inline list. Excel
//      caps an inline `"S,M,L"` formula at 255 characters; a W/L jeans run is
//      past that on its own, and Excel drops the validation silently rather
//      than refusing the file. A range reference has no such cap.
//   2. The barcode column is text-formatted. An EAN-13 in a General cell is a
//      number, and Excel renders 7072536000012 as 7.07254E+12 — then hands that
//      back on read. `numFmt: "@"` is what keeps thirteen digits thirteen
//      digits.
//   3. The Meta sheet carries the ids, not just the names. The upload step
//      recovers brand, season, kind and size system from the file rather than
//      asking again, so a file cannot be filled in for one brand and imported
//      against another.
//
// The Meta sheet is hidden, not protected: a determined person can still edit
// it. That is fine — parse.ts re-reads every id against the database and
// refuses what it cannot find. Hiding is to keep it out of the way, not to
// secure it.

import ExcelJS from "exceljs";
import type { SizeSystemView } from "./size-systems";

export const TEMPLATE_VERSION = 1;

/** The seven columns a person fills in. Order is part of the contract — the
 *  parser matches on header text, but a reordered file still reads correctly
 *  only because of that, so keep the two in step. */
export const IMPORT_COLUMNS = [
  "Style",
  "Colorway",
  "Size",
  "Price in",
  "Price out",
  "Barcode",
  "Category",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const SHEET_PRODUCTS = "Products";
export const SHEET_SIZES = "Sizes";
export const SHEET_META = "Meta";

export interface TemplateContext {
  brandId: string;
  brandName: string;
  seasonId: string;
  seasonCode: string;
  /** ProductKind — "MERCHANDISE" for ordinary goods. */
  kind: string;
  sizeSystem: SizeSystemView;
  /** Optional default, pre-filled into the Category column of every blank row. */
  categoryName?: string | null;
  /** How many empty rows to lay out. Rows beyond these still import — the
   *  validation and formatting are what run out, not the parser. */
  rows?: number;
}

/** Build the .xlsx. Returns the bytes and the filename to serve it under. */
export async function buildImportTemplate(
  ctx: TemplateContext
): Promise<{ filename: string; body: Buffer }> {
  const rowCount = Math.max(50, ctx.rows ?? 200);
  const sizes = ctx.sizeSystem.entries.filter((e) => !e.archived);
  if (!sizes.length)
    throw new Error(
      `Size system "${ctx.sizeSystem.name}" has no active sizes, so a file generated ` +
        `from it could not validate anything.`
    );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Origio";
  wb.created = new Date();

  // --- Sizes (hidden) — the source range for the dropdown -------------------
  const sizeSheet = wb.addWorksheet(SHEET_SIZES);
  sizeSheet.state = "veryHidden";
  sizeSheet.getColumn(1).width = 16;
  sizes.forEach((e, i) => {
    sizeSheet.getCell(i + 1, 1).value = e.sizeLabel;
  });
  const sizeRange = `${SHEET_SIZES}!$A$1:$A$${sizes.length}`;

  // --- Meta (hidden) — the batch's identity, read back on upload ------------
  const meta = wb.addWorksheet(SHEET_META);
  meta.state = "veryHidden";
  const metaRows: Array<[string, string]> = [
    ["templateVersion", String(TEMPLATE_VERSION)],
    ["brandId", ctx.brandId],
    ["brandName", ctx.brandName],
    ["seasonId", ctx.seasonId],
    ["seasonCode", ctx.seasonCode],
    ["kind", ctx.kind],
    ["sizeSystemId", ctx.sizeSystem.id],
    ["sizeSystemName", ctx.sizeSystem.name],
    ["sizeSystemKind", ctx.sizeSystem.kind],
    ["generatedAt", new Date().toISOString()],
  ];
  metaRows.forEach(([k, v], i) => {
    meta.getCell(i + 1, 1).value = k;
    meta.getCell(i + 1, 2).value = v;
  });

  // --- Products — the sheet a person actually fills in ----------------------
  const ws = wb.addWorksheet(SHEET_PRODUCTS, {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  // Banner. Read-only context, stated once, so the operator can see at a glance
  // which batch this file is — and so a file found in Downloads three weeks
  // later still says what it was for.
  banner(ws, 1, "Brand", ctx.brandName);
  banner(ws, 2, "Season", ctx.seasonCode);
  banner(ws, 3, "Type", ctx.kind);
  banner(ws, 4, "Sizes", `${ctx.sizeSystem.name} — ${sizes.map((s) => s.sizeLabel).join(", ")}`);
  ws.getCell("A5").value =
    "One row per size. Repeat the style and colourway on every row of that colourway; " +
    "prices are per colourway, so they must agree across its rows.";
  ws.getCell("A5").font = { italic: true, size: 9, color: { argb: "FF6B6B6B" } };
  ws.mergeCells("A5:G5");

  const header = ws.getRow(HEADER_ROW);
  IMPORT_COLUMNS.forEach((name, i) => {
    const cell = header.getCell(i + 1);
    cell.value = name;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { bottom: { style: "thin" } };
  });
  header.commit();

  const widths = [26, 22, 12, 11, 11, 16, 22];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const firstRow = HEADER_ROW + 1;
  const lastRow = HEADER_ROW + rowCount;

  // Barcode column as TEXT. Set on the column AND on each cell: a column-level
  // numFmt does not apply to cells Excel has not materialised, and a person
  // typing into row 120 of a 200-row sheet is doing exactly that.
  ws.getColumn(COL.barcode).numFmt = "@";
  ws.getColumn(COL.priceIn).numFmt = "0.00";
  ws.getColumn(COL.priceOut).numFmt = "0.00";

  for (let r = firstRow; r <= lastRow; r++) {
    ws.getCell(r, COL.barcode).numFmt = "@";

    ws.getCell(r, COL.size).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [sizeRange],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Not a size in this system",
      error:
        `This file was generated for "${ctx.sizeSystem.name}". Pick a size from the list — ` +
        `a size typed by hand would not match a size the importer can mint a SKU from.`,
    };

    for (const col of [COL.priceIn, COL.priceOut]) {
      ws.getCell(r, col).dataValidation = {
        type: "decimal",
        operator: "greaterThanOrEqual",
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Not a price",
        error: "Prices are numbers in NOK. Leave the cell empty if you do not know it yet.",
      };
    }

    if (ctx.categoryName) ws.getCell(r, COL.category).value = ctx.categoryName;
  }

  const body = Buffer.from(await wb.xlsx.writeBuffer());
  return { filename: filenameFor(ctx), body };
}

export const HEADER_ROW = 7;

/** 1-based column numbers, so the parser and the writer cannot drift. */
export const COL = {
  style: 1,
  colorway: 2,
  size: 3,
  priceIn: 4,
  priceOut: 5,
  barcode: 6,
  category: 7,
} as const;

function banner(ws: ExcelJS.Worksheet, row: number, label: string, value: string): void {
  const l = ws.getCell(row, 1);
  l.value = label;
  l.font = { bold: true, size: 10 };
  const v = ws.getCell(row, 2);
  v.value = value;
  v.font = { size: 10 };
  ws.mergeCells(row, 2, row, 7);
}

function filenameFor(ctx: TemplateContext): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `origio-import-${safe(ctx.brandName)}-${safe(ctx.seasonCode)}.xlsx`;
}
