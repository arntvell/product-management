// Loom fills master data it finds in a brand's files: barcodes, and the
// customs block. Those values belong in the master, not only in Loom, so Loom
// sends them here (PATCH /api/partner/v1/variants/master-data).
//
//   barcode   variant level, through applyVariantBarcodeEdits: the same path
//             as the barcode editor, so the ledger, the collision check and
//             the Shopify and Sitoo writes all apply. Not sent back to Loom
//             (skipLoom): the barcode came from Loom.
//   customs   colourway level (hs_code, country_of_origin,
//             customs_description, weight_kg, fiber_composition), through
//             writeCustoms, as overrides locked MANUAL so no enrichment pass
//             undoes them. Loom sends them per size; a value for one size is
//             the colourway's, so two sizes of one colourway that disagree
//             are refused rather than one picked.
//
// Customs are written to the master only. They reach Shopify and Sitoo with
// the product's next push, like any other customs edit.
import { prisma } from "@/lib/db";
import { applyVariantBarcodeEdits, planVariantBarcodeEdits, type MasterOutcome } from "@/lib/master/variant-barcodes";
import { writeCustoms, type CustomsPatch } from "@/lib/master/customs-write";
import { normalizeSku } from "@/lib/master/sku";
import { PartnerRequestError } from "./external-products";

export interface MasterDataItem {
  variant_sku: string;
  barcode?: string | null;
  hs_code?: string | null;
  country_of_origin?: string | null;
  customs_description?: string | null;
  weight_kg?: number | string | null;
  fiber_composition?: string | null;
}

export interface MasterDataResult {
  variant_sku: string;
  ok: boolean;
  barcode?: MasterOutcome;
  barcode_note?: string;
  customs?: { updated: number; fields: string[] };
  error?: string;
}

const CUSTOMS: [keyof MasterDataItem, keyof CustomsPatch][] = [
  ["hs_code", "hsCode"],
  ["country_of_origin", "countryOfOrigin"],
  ["customs_description", "customsDescription"],
  ["weight_kg", "weightKg"],
  ["fiber_composition", "fiberComposition"],
];

/** Barcode edits that land: everything else is a refusal for that size. */
const BARCODE_OK: MasterOutcome[] = ["fill", "change", "unchanged"];

export async function writeMasterData(body: {
  items?: unknown;
  dry_run?: unknown;
  evidence?: unknown;
}): Promise<{ dryRun: boolean; items: MasterDataResult[] }> {
  if (!Array.isArray(body.items)) throw new PartnerRequestError("items must be an array");
  const dryRun = body.dry_run === true;
  const evidence = typeof body.evidence === "string" && body.evidence.trim() ? body.evidence.trim() : null;
  const items = body.items as MasterDataItem[];

  // Resolve every SKU once, case and spacing aside.
  const wanted = [...new Set(items.map((i) => (typeof i?.variant_sku === "string" ? normalizeSku(i.variant_sku) : "")).filter(Boolean))];
  const variants = await prisma.variant.findMany({
    where: { variantSku: { in: wanted, mode: "insensitive" } },
    select: { variantSku: true, colorwayId: true },
  });
  const bySku = new Map(variants.map((v) => [normalizeSku(v.variantSku), v]));

  const results = new Map<MasterDataItem, MasterDataResult>();
  const valid: { item: MasterDataItem; sku: string; colorwayId: string }[] = [];
  for (const item of items) {
    const sku = typeof item?.variant_sku === "string" ? normalizeSku(item.variant_sku) : "";
    const v = sku ? bySku.get(sku) : undefined;
    if (!v) {
      results.set(item, { variant_sku: item?.variant_sku ?? "", ok: false, error: "Origio has no variant with this SKU" });
      continue;
    }
    results.set(item, { variant_sku: item.variant_sku, ok: true });
    valid.push({ item, sku: v.variantSku, colorwayId: v.colorwayId });
  }

  // --- customs, grouped by colourway; disagreeing sizes refuse the colourway ---
  const byColorway = new Map<string, typeof valid>();
  for (const v of valid) {
    if (!CUSTOMS.some(([k]) => present(v.item[k]))) continue;
    byColorway.set(v.colorwayId, [...(byColorway.get(v.colorwayId) ?? []), v]);
  }
  for (const [colorwayId, rows] of byColorway) {
    const patch: CustomsPatch = {};
    const clashes: string[] = [];
    for (const [k, field] of CUSTOMS) {
      const values = [...new Set(rows.map((r) => r.item[k]).filter(present).map((x) => String(x).trim()))];
      if (values.length > 1) clashes.push(`${k} (${values.join(" / ")})`);
      else if (values.length === 1) patch[field] = values[0];
    }
    if (clashes.length) {
      const error = `sizes of one colourway disagree on ${clashes.join(", ")}; customs are per colourway`;
      for (const r of rows) results.set(r.item, { ...results.get(r.item)!, ok: false, error });
      continue;
    }
    if (patch.weightKg !== undefined && !(Number(String(patch.weightKg).replace(",", ".")) > 0)) {
      for (const r of rows) results.set(r.item, { ...results.get(r.item)!, ok: false, error: "weight_kg must be a positive number" });
      continue;
    }
    if (patch.weightKg !== undefined) patch.weightKg = String(patch.weightKg).replace(",", ".");
    if (patch.countryOfOrigin) patch.countryOfOrigin = String(patch.countryOfOrigin).toUpperCase();
    const fields = Object.keys(patch);
    const customs = dryRun ? { updated: 1, fields } : await writeCustoms([colorwayId], patch);
    for (const r of rows) results.set(r.item, { ...results.get(r.item)!, customs: { updated: customs.updated, fields: customs.fields } });
  }

  // --- barcodes, through the editor's own path ---
  const edits = valid
    .filter((v) => present(v.item.barcode) && results.get(v.item)?.ok)
    .map((v) => ({ variantSku: v.sku, barcode: String(v.item.barcode).trim() }));
  if (edits.length) {
    const report = dryRun
      ? await planVariantBarcodeEdits(edits, { skipLoom: true })
      : await applyVariantBarcodeEdits(edits, { evidence: evidence ?? "Loom master-data", skipLoom: true });
    const rowBySku = new Map(report.rows.map((r) => [normalizeSku(r.variantSku), r]));
    for (const v of valid) {
      if (!present(v.item.barcode)) continue;
      const row = rowBySku.get(normalizeSku(v.sku));
      const prior = results.get(v.item)!;
      if (!row) continue;
      results.set(v.item, {
        ...prior,
        ok: prior.ok && BARCODE_OK.includes(row.master),
        barcode: row.master,
        ...(row.note ? { barcode_note: row.note } : {}),
        ...(!BARCODE_OK.includes(row.master) && !prior.error
          ? { error: `barcode ${row.master}${row.note ? `: ${row.note}` : ""}` }
          : {}),
      });
    }
  }

  return { dryRun, items: items.map((i) => results.get(i)!) };
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && String(v).trim() !== "";
}
