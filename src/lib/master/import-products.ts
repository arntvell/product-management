// Reading a filled-in import workbook, and turning it into drafts.
//
// SHAPE OF THE PROBLEM
//
// The file is flat — one row per size — and the master is a tree:
// Style -> Colorway -> Variant, with prices and a category hanging off the
// colourway. So the whole job is a regrouping, plus the refusals that keep a
// flat file from expressing something the tree cannot hold.
//
// WHY N DRAFTS, ONE PER STYLE
//
// `DraftPayloadV1.style` is a single style, and preflightDraft/finalizeDraft are
// written around that: one Style row, its colourways, one transaction. A file
// with four styles therefore becomes four drafts rather than one multi-style
// payload. That is not a workaround — it is what keeps the import on the SAME
// finalize path as the wizard, so the SKU collision checks, the barcode ledger
// check, the reserved-id claim and the resume-after-crash probe all apply to an
// imported product exactly as they do to a typed one. A second creation path
// would be a second set of those guarantees to keep in step, and the retired
// buildProductsForBrand is what that looks like when it goes wrong.
//
// WHAT THIS MODULE REFUSES, AND WHY EACH ONE IS A REFUSAL AND NOT A GUESS
//
//   a size not in the batch's size system   there is no entryId to mint a
//                                           variant SKU from, and inventing one
//                                           puts a size in the catalogue that no
//                                           size system knows about.
//   two prices for one colourway            Price is per colourway per season in
//                                           the schema. "Take the first" would
//                                           silently drop the other.
//   the same size twice in one colourway    it is one variant SKU, so the second
//                                           row is either a typo or a second
//                                           garment; both need a person.
//   two categories for one colourway        Colorway.categoryId is singular.
//                                           Per-LINE categories are read, but
//                                           they have to agree within a
//                                           colourway to be storable.
//   a barcode used twice in the file        preflight compares each draft against
//                                           the MASTER, so a collision between
//                                           two styles in one file would pass
//                                           both preflights and only surface
//                                           when the second one failed to
//                                           finalize. It is caught here instead.
//
// Category values that do not resolve are NOT a refusal — they are the decision
// the review step exists for: map to an existing category, or create one.

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import {
  COL,
  HEADER_ROW,
  IMPORT_COLUMNS,
  SHEET_META,
  SHEET_PRODUCTS,
  TEMPLATE_VERSION,
} from "./import-template";
import {
  buildColorwaySku,
  buildStyleSku,
  buildVariantSku,
  normalizeSku,
} from "./sku";
import { barcodeKey, rejectionReason, storedForm } from "./barcode";
import { categorySlug } from "./reference-pull";
import { createCategory } from "./categories";
import { missingBrandDefaults } from "./brands";
import { createDraft } from "./drafts";
import { saveDraft } from "./drafts";
import { emptyDraftPayload, type DraftColorway, type DraftPayloadV1, type DraftVariant } from "./draft-payload";
import type { ProductKind } from "@/generated/prisma/enums";
import type { PublishChannelKey } from "./fields";

export class ImportError extends Error {}

// ---------------------------------------------------------------------------
// Report types — what the review screen renders
// ---------------------------------------------------------------------------

/**
 * The brand defaults every imported product inherits.
 *
 * The file has seven columns and none of them is customs. These come from the
 * brand and nowhere else — not from the import screen, which used to ask for
 * them and so let one batch disagree with the next about what a Paraboot boot
 * weighs.
 */
export interface ImportDefaults {
  gender: string;
  unisex: boolean;
  hsCode: string;
  customsDescription: string;
  weightKg: string;
  fiberComposition: string;
  countryOfOrigin: string;
  manufacturerId: string;
}

export interface ImportContext {
  brandId: string;
  brandName: string;
  brandSkuToken: string | null;
  seasonId: string;
  seasonCode: string;
  kind: ProductKind;
  sizeSystemId: string;
  sizeSystemName: string;
  defaults: ImportDefaults;
  /** Labels of the required brand fields left blank. Non-empty blocks the import. */
  missingDefaults: string[];
}

export interface ImportVariantRow {
  row: number;
  sizeLabel: string;
  entryId: string;
  dim1: string;
  dim2: string | null;
  skuToken: string;
  variantSku: string;
  barcode: string | null;
}

export interface ImportColorway {
  name: string;
  colorwaySku: string;
  /** Raw category text as typed, before resolution. Null when every row was blank. */
  categoryValue: string | null;
  priceIn: string | null;
  priceOut: string | null;
  variants: ImportVariantRow[];
}

export interface ImportStyle {
  styleName: string;
  styleSku: string;
  mode: "existing" | "new";
  existingId: string | null;
  /** The style's category — the one its colourways agree on, when they do. */
  categoryValue: string | null;
  colorways: ImportColorway[];
}

/** One distinct category string in the file, and what it resolves to. */
export interface CategoryDecisionNeeded {
  value: string;
  slug: string;
  /** Set when an existing category already covers this spelling. */
  matchedId: string | null;
  matchedName: string | null;
  /** Rows carrying this value, so the count tells the reviewer how much rides on it. */
  rowCount: number;
  /** True when the match exists but has no Sitoo id — a SITOO push would block. */
  missingSitooId: boolean;
}

export interface ImportReport {
  context: ImportContext;
  styles: ImportStyle[];
  categories: CategoryDecisionNeeded[];
  errors: string[];
  warnings: string[];
  counts: { rows: number; styles: number; colorways: number; variants: number };
  /** True when nothing blocks a commit. Unresolved categories are not errors —
   *  they are answered by the decisions passed to commitImport. */
  ok: boolean;
}

/** What the reviewer decided about each unresolved category value. */
export type CategoryDecision =
  | { value: string; action: "map"; categoryId: string }
  | { value: string; action: "create"; name: string; parentId?: string | null };

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export async function parseImportWorkbook(buffer: Buffer): Promise<ImportReport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportError(
      "That file is not a readable .xlsx. Upload the workbook the template step produced, " +
        "not a CSV or a re-saved copy."
    );
  }

  const context = await readContext(wb);
  const ws = wb.getWorksheet(SHEET_PRODUCTS);
  if (!ws)
    throw new ImportError(
      `The workbook has no "${SHEET_PRODUCTS}" sheet. Renaming it breaks the import — ` +
        `generate a fresh template and paste the rows in.`
    );
  assertHeaders(ws);

  const errors: string[] = [];
  const warnings: string[] = [];

  // Size system, live from the database rather than the file: an archived size
  // must stop being offered to new product even if the file predates archiving.
  const system = await prisma.sizeSystem.findUnique({
    where: { id: context.sizeSystemId },
    select: { entries: { orderBy: { position: "asc" } } },
  });
  if (!system) throw new ImportError("The size system this file was generated for no longer exists.");
  const byLabel = new Map<string, (typeof system.entries)[number]>();
  for (const e of system.entries) if (!e.archived) byLabel.set(e.sizeLabel.trim().toLowerCase(), e);

  // --- read the rows -------------------------------------------------------
  interface RawRow {
    row: number;
    style: string;
    colorway: string;
    size: string;
    priceIn: string;
    priceOut: string;
    barcode: string;
    category: string;
  }
  const raw: RawRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= HEADER_ROW) return;
    const r: RawRow = {
      row: rowNumber,
      style: text(row.getCell(COL.style)),
      colorway: text(row.getCell(COL.colorway)),
      size: text(row.getCell(COL.size)),
      priceIn: text(row.getCell(COL.priceIn)),
      priceOut: text(row.getCell(COL.priceOut)),
      barcode: text(row.getCell(COL.barcode)),
      category: text(row.getCell(COL.category)),
    };
    if (!r.style && !r.colorway && !r.size && !r.barcode && !r.priceIn && !r.priceOut) return;
    raw.push(r);
  });

  if (!raw.length)
    throw new ImportError("Every row in the file is empty — there is nothing to import.");

  // --- group: style -> colourway -> rows ------------------------------------
  interface Group {
    styleName: string;
    colorways: Map<string, { name: string; rows: RawRow[] }>;
  }
  const groups = new Map<string, Group>();
  for (const r of raw) {
    if (!r.style) {
      errors.push(`Row ${r.row}: no style. Repeat the style name on every row of a colourway.`);
      continue;
    }
    if (!r.colorway) {
      errors.push(`Row ${r.row}: no colourway.`);
      continue;
    }
    const sKey = r.style.trim().toLowerCase();
    let g = groups.get(sKey);
    if (!g) {
      g = { styleName: r.style.trim(), colorways: new Map() };
      groups.set(sKey, g);
    }
    const cKey = r.colorway.trim().toLowerCase();
    let c = g.colorways.get(cKey);
    if (!c) {
      c = { name: r.colorway.trim(), rows: [] };
      g.colorways.set(cKey, c);
    }
    c.rows.push(r);
  }

  // --- existing styles under this brand, matched by name --------------------
  const existing = await prisma.style.findMany({
    where: { brandId: context.brandId },
    select: { id: true, styleSku: true, styleName: true },
  });
  const existingByName = new Map(existing.map((s) => [s.styleName.trim().toLowerCase(), s]));

  // --- build the tree ------------------------------------------------------
  const styles: ImportStyle[] = [];
  const barcodeOwner = new Map<string, string>(); // barcodeKey -> "row N (SKU)"
  const skuOwner = new Map<string, string>(); // normalised SKU -> where it came from
  // Keyed by SLUG, not by the raw spelling. "Shirts" and "shirts" are one
  // category — offering them as two decisions would let a reviewer press
  // "create" on both, and the second createCategory throws `already covers that
  // name` AFTER the first has committed. The first spelling seen is kept for
  // display.
  const categoryRows = new Map<string, { value: string; rows: number }>();

  for (const g of groups.values()) {
    const hit = existingByName.get(g.styleName.toLowerCase());
    const styleSku = hit
      ? hit.styleSku
      : buildStyleSku({
          prefix: "EXT",
          brandToken: context.brandSkuToken,
          brandName: context.brandName,
          style: g.styleName,
        });

    claim(skuOwner, styleSku, `style "${g.styleName}"`, errors, hit ? null : "style");

    const colorways: ImportColorway[] = [];
    for (const c of g.colorways.values()) {
      const colorwaySku = buildColorwaySku(styleSku, c.name);
      claim(skuOwner, colorwaySku, `colourway "${c.name}"`, errors, "colorway");

      // prices — one per colourway, so its rows must agree
      const priceIn = agree(c.rows, (r) => r.priceIn, money);
      const priceOut = agree(c.rows, (r) => r.priceOut, money);
      if (priceIn === DISAGREE)
        errors.push(
          `"${g.styleName} / ${c.name}" has more than one price in (rows ` +
            `${c.rows.map((r) => r.row).join(", ")}). A price is per colourway.`
        );
      if (priceOut === DISAGREE)
        errors.push(
          `"${g.styleName} / ${c.name}" has more than one price out (rows ` +
            `${c.rows.map((r) => r.row).join(", ")}). A price is per colourway.`
        );

      // category — read per LINE, but has to agree within the colourway
      const category = agree(c.rows, (r) => r.category, (v) => v.trim());
      if (category === DISAGREE)
        errors.push(
          `"${g.styleName} / ${c.name}" has more than one category across its rows ` +
            `(${[...new Set(c.rows.map((r) => r.category).filter(Boolean))].join(", ")}). ` +
            `A colourway carries one category, so these have to agree.`
        );
      const categoryValue = category === DISAGREE ? null : category;
      if (categoryValue) {
        const slug = categorySlug(categoryValue);
        const prior = categoryRows.get(slug);
        categoryRows.set(slug, {
          value: prior?.value ?? categoryValue,
          rows: (prior?.rows ?? 0) + c.rows.length,
        });
      }

      // variants
      const variants: ImportVariantRow[] = [];
      const seenSize = new Map<string, number>();
      for (const r of c.rows) {
        if (!r.size) {
          errors.push(`Row ${r.row}: no size.`);
          continue;
        }
        const entry = byLabel.get(r.size.trim().toLowerCase());
        if (!entry) {
          errors.push(
            `Row ${r.row}: "${r.size}" is not an active size in ${context.sizeSystemName}. ` +
              `Pick from the dropdown — a size typed by hand has no SKU token to mint from.`
          );
          continue;
        }
        const prior = seenSize.get(entry.id);
        if (prior !== undefined) {
          errors.push(
            `"${g.styleName} / ${c.name}" lists ${entry.sizeLabel} twice (rows ${prior} and ${r.row}).`
          );
          continue;
        }
        seenSize.set(entry.id, r.row);

        const variantSku = buildVariantSku(colorwaySku, entry.skuToken);
        claim(skuOwner, variantSku, `row ${r.row}`, errors, "variant");

        let barcode: string | null = null;
        if (r.barcode) {
          // Stored as given for an EAN-13, as 12 digits for a UPC-A — padding
          // it with a zero is what stopped Pantherella scanning (2026-09-23).
          barcode = storedForm(r.barcode);
          const key = barcodeKey(r.barcode);
          if (!barcode || !key) {
            errors.push(`Row ${r.row}: ${rejectionReason(r.barcode) ?? "not a barcode"}.`);
          } else {
            const owner = barcodeOwner.get(key);
            if (owner) errors.push(`Barcode ${barcode} is on row ${owner} and row ${r.row}.`);
            else barcodeOwner.set(key, String(r.row));
          }
        }

        variants.push({
          row: r.row,
          sizeLabel: entry.sizeLabel,
          entryId: entry.id,
          dim1: entry.dim1,
          dim2: entry.dim2,
          skuToken: entry.skuToken,
          variantSku,
          barcode,
        });
      }

      if (!variants.length)
        errors.push(`"${g.styleName} / ${c.name}" has no usable size rows.`);

      colorways.push({
        name: c.name,
        colorwaySku,
        categoryValue,
        priceIn: priceIn === DISAGREE ? null : priceIn,
        priceOut: priceOut === DISAGREE ? null : priceOut,
        variants,
      });
    }

    const distinct = [...new Set(colorways.map((c) => c.categoryValue).filter(Boolean))] as string[];
    styles.push({
      styleName: g.styleName,
      styleSku,
      mode: hit ? "existing" : "new",
      existingId: hit?.id ?? null,
      // A style-level category only exists when its colourways agree. When they
      // do not, each colourway carries its own and the style falls back to the
      // first — Style.category is a label, Colorway.categoryId is what pushes.
      categoryValue: distinct.length === 1 ? distinct[0] : (distinct[0] ?? null),
      colorways,
    });
  }

  if (!styles.some((s) => s.colorways.length))
    errors.push("No colourway in the file has a usable row.");

  // --- categories against the master ---------------------------------------
  const slugs = [...categoryRows.keys()];
  const matches = slugs.length
    ? await prisma.category.findMany({
        where: { slug: { in: slugs }, archived: false },
        select: { id: true, slug: true, name: true, sitooCategoryId: true },
      })
    : [];
  const bySlug = new Map(matches.map((m) => [m.slug, m]));
  const categories: CategoryDecisionNeeded[] = slugs.map((slug) => {
    const m = bySlug.get(slug) ?? null;
    const row = categoryRows.get(slug)!;
    return {
      value: row.value,
      slug,
      matchedId: m?.id ?? null,
      matchedName: m?.name ?? null,
      rowCount: row.rows,
      missingSitooId: !!m && !m.sitooCategoryId,
    };
  });

  const missingCategory = styles.flatMap((s) =>
    s.colorways.filter((c) => !c.categoryValue).map((c) => `${s.styleName} / ${c.name}`)
  );
  if (missingCategory.length)
    errors.push(
      `No category on ${missingCategory.length} colourway(s): ${missingCategory.slice(0, 5).join(", ")}` +
        `${missingCategory.length > 5 ? "…" : ""}. Every product needs one — it is what the push maps outward.`
    );

  if (context.missingDefaults.length)
    errors.push(
      `${context.brandName} is missing ${context.missingDefaults.join(", ")}. An imported ` +
        `product inherits all of these from the brand — the file carries none of them — so ` +
        `they have to be filled in on the brand before anything can be created.`
    );

  const noBarcode = styles.reduce(
    (a, s) => a + s.colorways.reduce((b, c) => b + c.variants.filter((v) => !v.barcode).length, 0),
    0
  );
  if (noBarcode)
    warnings.push(
      `${noBarcode} size${noBarcode === 1 ? " has" : "s have"} no barcode. They import fine, but ` +
        `Loom's registry sends barcoded variants only, so they will not reach it until one is filled in.`
    );
  const existingStyles = styles.filter((s) => s.mode === "existing");
  if (existingStyles.length)
    warnings.push(
      `${existingStyles.length} style name${existingStyles.length === 1 ? "" : "s"} already exist ` +
        `under ${context.brandName} (${existingStyles.map((s) => s.styleName).join(", ")}). Their ` +
        `colourways will nest under the existing style, and its SKU is reused exactly as it is.`
    );

  const counts = {
    rows: raw.length,
    styles: styles.length,
    colorways: styles.reduce((a, s) => a + s.colorways.length, 0),
    variants: styles.reduce((a, s) => a + s.colorways.reduce((b, c) => b + c.variants.length, 0), 0),
  };

  return {
    context,
    styles,
    categories,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    counts,
    ok: errors.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Commit — one draft per style
// ---------------------------------------------------------------------------

export interface CommitOptions {
  channels: PublishChannelKey[];
  decisions: CategoryDecision[];
}

export interface CommitResult {
  drafts: Array<{ id: string; styleName: string; colorways: number; variants: number }>;
  createdCategories: Array<{ id: string; name: string }>;
}

export async function commitImport(
  report: ImportReport,
  opts: CommitOptions
): Promise<CommitResult> {
  if (!report.ok)
    throw new ImportError("This file still has errors — they have to be fixed before importing.");
  if (!opts.channels.length) throw new ImportError("Select at least one channel.");

  // Re-read rather than trusting the report's copy. A report is parsed bytes
  // from minutes ago; the brand could have been completed — or emptied — since,
  // and this is the last refusal before rows exist.
  const brand = await prisma.brand.findUnique({
    where: { id: report.context.brandId },
    select: { template: true },
  });
  const t = {
    gender: brand?.template?.gender ?? "",
    unisex: brand?.template?.unisex ?? false,
    hsCode: brand?.template?.hsCode ?? "",
    customsDescription: brand?.template?.customsDescription ?? "",
    weightKg: brand?.template?.weightKg?.toString() ?? "",
    fiberComposition: brand?.template?.fiberComposition ?? "",
    countryOfOrigin: brand?.template?.countryOfOrigin ?? "",
    manufacturerId: brand?.template?.manufacturerId ?? "",
  };
  const missing = missingBrandDefaults(t);
  if (missing.length)
    throw new ImportError(
      `${report.context.brandName} is missing ${missing.join(", ")}. Fill those in on the ` +
        `brand first — an imported product has nowhere else to get them from.`
    );

  // Resolve every category value to an id, creating what the reviewer asked for.
  // Creation happens FIRST and outside the draft loop: a half-applied set of
  // categories with no drafts is recoverable, drafts pointing at a category that
  // failed to create is not.
  // Decisions arrive keyed by the spelling the report showed; a colourway holds
  // whatever its rows said. Both are folded to the slug so the two agree.
  const decisionByValue = new Map(opts.decisions.map((d) => [categorySlug(d.value), d]));
  const categoryIdByValue = new Map<string, string>();
  const createdCategories: CommitResult["createdCategories"] = [];

  for (const c of report.categories) {
    const d = decisionByValue.get(c.slug);
    if (d?.action === "create") {
      const id = await createCategory({ name: d.name.trim() || c.value, parentId: d.parentId ?? null });
      categoryIdByValue.set(c.slug, id);
      createdCategories.push({ id, name: d.name.trim() || c.value });
      continue;
    }
    if (d?.action === "map") {
      categoryIdByValue.set(c.slug, d.categoryId);
      continue;
    }
    if (c.matchedId) {
      categoryIdByValue.set(c.slug, c.matchedId);
      continue;
    }
    throw new ImportError(
      `"${c.value}" is not a category yet, and no decision was made about it. ` +
        `Map it to an existing category or create it.`
    );
  }

  const names = await prisma.category.findMany({
    where: { id: { in: [...new Set(categoryIdByValue.values())] } },
    select: { id: true, name: true },
  });
  const categoryNameById = new Map(names.map((n) => [n.id, n.name]));

  const drafts: CommitResult["drafts"] = [];

  for (const s of report.styles) {
    const styleCategoryId = s.categoryValue
      ? categoryIdByValue.get(categorySlug(s.categoryValue)) ?? ""
      : "";
    const base = emptyDraftPayload();
    const payload: DraftPayloadV1 = {
      ...base,
      brand: {
        id: report.context.brandId,
        name: report.context.brandName,
        skuToken: report.context.brandSkuToken,
        isLivid: false,
      },
      seasonId: report.context.seasonId,
      channels: opts.channels,
      kind: report.context.kind,
      // Marks the draft as import-born, which is what makes the customs gate in
      // preflightPayload apply to it and not to a hand-typed draft.
      origin: "import",
      // Copied in, not referenced. A draft is a snapshot of an intent: editing
      // the brand next week must not silently rewrite what a draft created
      // today was going to be.
      template: {
        ...base.template,
        categoryId: styleCategoryId,
        category: styleCategoryId ? categoryNameById.get(styleCategoryId) ?? "" : "",
        gender: t.gender,
        unisex: t.unisex,
        hsCode: t.hsCode,
        customsDescription: t.customsDescription,
        weightKg: t.weightKg,
        fiberComposition: t.fiberComposition,
        countryOfOrigin: t.countryOfOrigin,
        manufacturerId: t.manufacturerId,
        defaultSizeSystemId: report.context.sizeSystemId,
      },
      style:
        s.mode === "existing"
          ? { mode: "existing", id: s.existingId!, styleSku: s.styleSku, styleName: s.styleName }
          : { mode: "new", styleName: s.styleName, styleSku: s.styleSku, manualSku: false },
      colorways: s.colorways.map((c): DraftColorway => {
        const catId = c.categoryValue
          ? categoryIdByValue.get(categorySlug(c.categoryValue)) ?? ""
          : "";
        return {
          key: key(),
          name: c.name,
          color: c.name,
          swatchHex: null,
          colorwaySku: normalizeSku(c.colorwaySku),
          manualSku: false,
          kind: null,
          sizeSystemId: report.context.sizeSystemId,
          // Null when it equals the style's — the draft inherits, and only a
          // genuine per-colourway difference is stored as an override.
          categoryId: catId && catId !== styleCategoryId ? catId : null,
          category: catId && catId !== styleCategoryId ? categoryNameById.get(catId) ?? null : null,
          variants: c.variants.map(
            (v): DraftVariant => ({
              key: key(),
              entryId: v.entryId,
              sizeLabel: v.sizeLabel,
              dim1: v.dim1,
              dim2: v.dim2,
              skuToken: v.skuToken,
              variantSku: normalizeSku(v.variantSku),
              barcode: v.barcode,
              barcodeSource: v.barcode ? "csv" : null,
            })
          ),
          prices: {
            ...(c.priceIn ? { COST: c.priceIn } : {}),
            ...(c.priceOut ? { MSRP: c.priceOut } : {}),
          },
        };
      }),
    };

    const id = await createDraft();
    // Straight to review: an imported draft has every step's answer in it
    // already, so the wizard opens on the screen that decides whether to create.
    await saveDraft(id, { revision: 0, payload, step: "review" });
    drafts.push({
      id,
      styleName: s.styleName,
      colorways: payload.colorways.length,
      variants: payload.colorways.reduce((a, c) => a + c.variants.length, 0),
    });
  }

  return { drafts, createdCategories };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function readContext(wb: ExcelJS.Workbook): Promise<ImportContext> {
  const meta = wb.getWorksheet(SHEET_META);
  if (!meta)
    throw new ImportError(
      "This workbook carries no batch information. It has to be a file the template step " +
        "generated — that is where the brand, season and size system come from."
    );
  const m = new Map<string, string>();
  meta.eachRow((row) => {
    const k = text(row.getCell(1));
    const v = text(row.getCell(2));
    if (k) m.set(k, v);
  });

  const version = Number(m.get("templateVersion") ?? "0");
  if (version !== TEMPLATE_VERSION)
    throw new ImportError(
      `This file was generated by a different version of the template (v${version || "?"} ` +
        `against v${TEMPLATE_VERSION}). The columns have moved since — download a fresh ` +
        `one and paste the rows across.`
    );

  const brandId = m.get("brandId") ?? "";
  const seasonId = m.get("seasonId") ?? "";
  const sizeSystemId = m.get("sizeSystemId") ?? "";
  const kind = (m.get("kind") ?? "MERCHANDISE") as ProductKind;

  // Every id is re-read from the database. The Meta sheet is hidden, not
  // protected, and a renamed brand should import under its current name.
  const [brand, season, system] = await Promise.all([
    prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        id: true,
        name: true,
        skuToken: true,
        isLivid: true,
        archived: true,
        template: true,
      },
    }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, code: true } }),
    prisma.sizeSystem.findUnique({
      where: { id: sizeSystemId },
      select: { id: true, name: true, archived: true },
    }),
  ]);

  if (!brand) throw new ImportError("The brand this file was generated for no longer exists.");
  if (brand.isLivid)
    throw new ImportError(
      "Livid product comes from Threadflow. This importer creates external brands only."
    );
  if (brand.archived) throw new ImportError(`"${brand.name}" is archived.`);
  if (!season) throw new ImportError("The season this file was generated for no longer exists.");
  if (!system) throw new ImportError("The size system this file was generated for no longer exists.");

  const t = brand.template;
  const defaults: ImportDefaults = {
    gender: t?.gender ?? "",
    unisex: t?.unisex ?? false,
    hsCode: t?.hsCode ?? "",
    customsDescription: t?.customsDescription ?? "",
    weightKg: t?.weightKg?.toString() ?? "",
    fiberComposition: t?.fiberComposition ?? "",
    countryOfOrigin: t?.countryOfOrigin ?? "",
    manufacturerId: t?.manufacturerId ?? "",
  };

  return {
    brandId: brand.id,
    brandName: brand.name,
    brandSkuToken: brand.skuToken,
    seasonId: season.id,
    seasonCode: season.code,
    kind,
    sizeSystemId: system.id,
    sizeSystemName: system.name,
    defaults,
    missingDefaults: missingBrandDefaults({ ...defaults }),
  };
}

function assertHeaders(ws: ExcelJS.Worksheet): void {
  const row = ws.getRow(HEADER_ROW);
  const seen = IMPORT_COLUMNS.map((_, i) => text(row.getCell(i + 1)).toLowerCase());
  const want = IMPORT_COLUMNS.map((c) => c.toLowerCase());
  if (seen.join("|") !== want.join("|"))
    throw new ImportError(
      `The header row does not match the template. Expected ${IMPORT_COLUMNS.join(", ")} ` +
        `on row ${HEADER_ROW}, found ${seen.filter(Boolean).join(", ") || "nothing"}. ` +
        `Inserting or deleting rows above the header moves it — paste into a fresh template instead.`
    );
}

/**
 * A cell as text.
 *
 * Excel hands back a number for a barcode typed into a General cell, a
 * `{ richText }` object for anything styled mid-string, and a `{ result }` for a
 * formula. `String(cell.value)` on the first of those is where 7.07254E+12 comes
 * from, so a large integer is rendered without exponent notation explicitly.
 */
function text(cell: ExcelJS.Cell | undefined): string {
  const v = cell?.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return numberText(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText))
      return (o.richText as Array<{ text?: string }>).map((p) => p.text ?? "").join("").trim();
    if ("result" in o) return text({ value: o.result } as unknown as ExcelJS.Cell);
    if ("text" in o && typeof o.text === "string") return o.text.trim();
    if ("hyperlink" in o && typeof o.text === "string") return String(o.text).trim();
  }
  return String(v).trim();
}

function numberText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) return n.toFixed(0);
  // toFixed(10) then trim: keeps 1234.5 as "1234.5" and never reaches for
  // exponent notation the way String(1e21) does.
  return n.toFixed(10).replace(/\.?0+$/, "");
}

const DISAGREE = Symbol("disagree");

/** The single non-blank value across a colourway's rows, or DISAGREE. */
function agree<R>(
  rows: R[],
  read: (r: R) => string,
  normalize: (v: string) => string
): string | null | typeof DISAGREE {
  const values = new Set<string>();
  for (const r of rows) {
    const v = read(r).trim();
    if (v) values.add(normalize(v));
  }
  if (values.size === 0) return null;
  if (values.size > 1) return DISAGREE;
  return [...values][0];
}

/** "1 299,50" and "1299.5" are the same price. Returns a plain decimal string. */
function money(raw: string): string {
  const cleaned = raw.replace(/\s| /g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return raw.trim();
  return n.toFixed(2).replace(/\.00$/, "");
}

/** Record which row minted a SKU, and complain when two rows mint the same one. */
function claim(
  owners: Map<string, string>,
  sku: string,
  where: string,
  errors: string[],
  level: string | null
): void {
  if (!level) return; // an existing style's SKU is expected to repeat
  const n = normalizeSku(sku);
  const prior = owners.get(n);
  if (prior && prior !== where)
    errors.push(
      `${sku} would be minted for both ${prior} and ${where}. Two ${level}s in this file ` +
        `spell to the same SKU — give one of them a distinct name.`
    );
  else owners.set(n, where);
}

function key(): string {
  return Math.random().toString(36).slice(2, 10);
}
