// The barcode round-trip: export the draft's sizes, fill the column in Excel,
// import it back.
//
// Ordering is the part that matters. The file is sorted style -> colourway ->
// SIZE POSITION, not alphabetically, because somebody filling this in is reading
// codes off a physical size run. Alphabetical would put 10 before 9 and W30/L34
// before W28/L32, and a row-shifted barcode file is precisely the defect that
// took a phone call to two stores to unpick.

import { prisma } from "@/lib/db";
import { toCsv, parseCsvRecords, UTF8_BOM } from "@/lib/csv";
import { canonical, rejectionReason } from "./barcode";
import { normalizeSku } from "./sku";
import { parseDraftPayload, type DraftPayloadV1 } from "./draft-payload";

const HEADERS = [
  "Style",
  "Style SKU",
  "Colourway",
  "Colourway SKU",
  "Size",
  "Variant SKU",
  "Barcode",
];

export async function draftBarcodeCsv(draftId: string): Promise<{ filename: string; body: string }> {
  const draft = await prisma.productDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error("Draft not found.");
  const p = parseDraftPayload(draft.payload);

  const rows: string[][] = [];
  for (const cw of p.colorways) {
    // Variants are already held in size-system order; keep it.
    for (const v of cw.variants) {
      rows.push([
        p.style?.styleName ?? "",
        p.style?.styleSku ?? "",
        cw.name,
        cw.colorwaySku,
        v.sizeLabel,
        v.variantSku,
        v.barcode ?? "",
      ]);
    }
  }

  return {
    filename: `origio-barcodes-${draftId.slice(-8)}.csv`,
    body: UTF8_BOM + toCsv(HEADERS, rows),
  };
}

export interface BarcodeImportReport {
  matched: number;
  filled: number;
  unchanged: number;
  cleared: number;
  /** Rows whose variant SKU is not in this draft. Reported, never created. */
  unknown: string[];
  rejected: Array<{ variantSku: string; value: string; reason: string }>;
  dryRun: boolean;
}

/**
 * Apply a filled-in file to a draft's payload.
 *
 * Joins on variant SKU, so the rows can be sorted, filtered or reordered in
 * Excel without consequence. Nothing is written unless the whole file parses and
 * every barcode is either valid or explicitly reported.
 */
export function applyBarcodeCsv(
  payload: DraftPayloadV1,
  text: string
): { payload: DraftPayloadV1; report: BarcodeImportReport } {
  const records = parseCsvRecords(text);
  const report: BarcodeImportReport = {
    matched: 0,
    filled: 0,
    unchanged: 0,
    cleared: 0,
    unknown: [],
    rejected: [],
    dryRun: false,
  };

  const bySku = new Map<string, { cwKey: string; vKey: string }>();
  for (const cw of payload.colorways)
    for (const v of cw.variants)
      bySku.set(normalizeSku(v.variantSku), { cwKey: cw.key, vKey: v.key });

  const updates = new Map<string, string | null>();
  const seenCodes = new Map<string, string>();

  for (const rec of records) {
    const sku = rec["Variant SKU"] ?? rec["variantSku"] ?? "";
    if (!sku.trim()) continue;
    const hit = bySku.get(normalizeSku(sku));
    if (!hit) {
      report.unknown.push(sku);
      continue;
    }
    report.matched++;

    const raw = (rec["Barcode"] ?? rec["barcode"] ?? "").trim();
    if (!raw) {
      updates.set(hit.vKey, null);
      continue;
    }
    const code = canonical(raw);
    if (!code) {
      report.rejected.push({
        variantSku: sku,
        value: raw,
        reason: rejectionReason(raw) ?? "not a barcode",
      });
      continue;
    }
    const prior = seenCodes.get(code);
    if (prior) {
      report.rejected.push({
        variantSku: sku,
        value: raw,
        reason: `the same code is on ${prior} in this file`,
      });
      continue;
    }
    seenCodes.set(code, sku);
    updates.set(hit.vKey, code);
  }

  const next: DraftPayloadV1 = {
    ...payload,
    colorways: payload.colorways.map((cw) => ({
      ...cw,
      variants: cw.variants.map((v) => {
        if (!updates.has(v.key)) return v;
        const value = updates.get(v.key)!;
        if (value === null) {
          if (v.barcode) report.cleared++;
          return { ...v, barcode: null, barcodeSource: null };
        }
        if (v.barcode === value) {
          report.unchanged++;
          return v;
        }
        report.filled++;
        return { ...v, barcode: value, barcodeSource: "csv" as const };
      }),
    })),
  };

  return { payload: next, report };
}
