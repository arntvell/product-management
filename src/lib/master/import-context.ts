// The batch an import is for — brand, season, kind, size systems, categories —
// resolved from ids. Shared by the template download and the typed-in import,
// so both build exactly the same workbook from the same choices.

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { buildImportTemplate, COL, HEADER_ROW, SHEET_PRODUCTS, type TemplateContext } from "./import-template";
import { listSizeSystems } from "./size-systems";

export class ImportContextError extends Error {
  constructor(
    message: string,
    readonly status = 422
  ) {
    super(message);
  }
}

export interface BatchChoice {
  brandId: string;
  seasonId: string;
  kind?: string;
  sizeSystemIds: string[];
  categoryIds: string[];
}

export async function resolveTemplateContext(b: BatchChoice): Promise<TemplateContext> {
  const missing = [
    !b.brandId && "brand",
    !b.seasonId && "season",
    !b.sizeSystemIds.length && "size system",
    !b.categoryIds.length && "category",
  ].filter(Boolean);
  if (missing.length) throw new ImportContextError(`Choose a ${missing.join(", a ")} first.`, 400);

  const [brand, season, systems, categories] = await Promise.all([
    prisma.brand.findUnique({
      where: { id: b.brandId },
      select: { id: true, name: true, isLivid: true },
    }),
    prisma.season.findUnique({ where: { id: b.seasonId }, select: { id: true, code: true } }),
    listSizeSystems(),
    prisma.category.findMany({
      where: { id: { in: b.categoryIds }, archived: false },
      select: { id: true, name: true },
    }),
  ]);

  if (!brand) throw new ImportContextError("Brand not found.", 404);
  if (brand.isLivid)
    throw new ImportContextError(
      "Livid product comes from Threadflow. This importer creates external brands only."
    );
  if (!season) throw new ImportContextError("Season not found.", 404);
  const sizeSystems = b.sizeSystemIds
    .map((id) => systems.find((s) => s.id === id))
    .filter((s): s is (typeof systems)[number] => !!s);
  if (sizeSystems.length !== b.sizeSystemIds.length)
    throw new ImportContextError("A chosen size system no longer exists.", 404);
  if (categories.length !== b.categoryIds.length)
    throw new ImportContextError("One of the chosen categories no longer exists — pick them again.", 404);

  // Ordered as the operator picked them, so the dropdown reads the way the
  // screen did.
  const ordered = b.categoryIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is { id: string; name: string } => !!c);

  return {
    brandId: brand.id,
    brandName: brand.name,
    seasonId: season.id,
    seasonCode: season.code,
    kind: b.kind || "MERCHANDISE",
    sizeSystems,
    categories: ordered,
  };
}

/** One size of one colourway, as the template's columns hold it. */
export interface TypedRow {
  style: string;
  colorway: string;
  size: string;
  priceIn?: string;
  priceOut?: string;
  barcode?: string;
  category?: string;
  sizeSystem?: string;
}

/**
 * The workbook a person would have filled in, built from typed rows.
 *
 * The typed-in import does not get a parser of its own: it writes its rows
 * into the very template the download produces and hands the bytes to
 * parseImportWorkbook. Every rule the file import enforces — sizes in their
 * system, one price per colourway, barcodes unique, existing styles matched —
 * applies to typed rows because they ARE a file by then.
 */
export async function workbookFromRows(ctx: TemplateContext, rows: TypedRow[]): Promise<Buffer> {
  if (!rows.length) throw new ImportContextError("Nothing typed in yet.", 400);
  if (rows.length > 2000) throw new ImportContextError("More than 2,000 sizes — use the file for that.", 413);
  const { body } = await buildImportTemplate({ ...ctx, rows: rows.length + 10 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(SHEET_PRODUCTS);
  if (!ws) throw new Error("The template has no Products sheet.");
  rows.forEach((r, i) => {
    const row = ws.getRow(HEADER_ROW + 1 + i);
    const put = (col: number, v: string | undefined) => {
      row.getCell(col).value = (v ?? "").trim() || null;
    };
    put(COL.style, r.style);
    put(COL.colorway, r.colorway);
    put(COL.size, r.size);
    put(COL.priceIn, r.priceIn);
    put(COL.priceOut, r.priceOut);
    put(COL.barcode, r.barcode);
    put(COL.category, r.category);
    put(COL.sizeSystem, r.sizeSystem);
    row.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
