// The Pio inventory export — the warehouse's own SKU list.
//
// Useful here for one thing the other systems cannot settle: which of two
// competing SKUs the warehouse actually picks stock under. Pio is where someone
// physically walks to a bin, so a SKU carrying quantity there is a SKU in real
// use, and its twin with zero is a record nobody picks from.
//
// Read from the export rather than an API — it is a CFO-supplied snapshot, so
// the file name carries the date it describes.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeSku } from "./sku";

export interface PioRow {
  sku: string;
  productName: string;
  quantity: number;
  bins: number;
}

export interface PioIndex {
  /** normalised variant SKU -> row */
  bySku: Map<string, PioRow>;
  /** normalised colourway stem (variant SKU minus its size) -> total quantity */
  qtyByStem: Map<string, number>;
  source: string;
  rows: number;
}

const DEFAULT_EXPORT =
  "snapshots/2026-09-11/worklists/Pio-Inventory-SKU-Report-2026-09-11-1.csv";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function loadPio(file = DEFAULT_EXPORT): Promise<PioIndex | null> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), file), "utf8");
  } catch {
    // The export is optional — everything here degrades to "no Pio column".
    return null;
  }
  const lines = text.trim().split(/\r?\n/);
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iSku = idx("sku");
  const iName = idx("product_name");
  const iQty = idx("quantity");
  const iBins = idx("number_of_bins");

  const bySku = new Map<string, PioRow>();
  const qtyByStem = new Map<string, number>();

  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const raw = (c[iSku] ?? "").trim();
    if (!raw) continue;
    const sku = normalizeSku(raw);
    const row: PioRow = {
      sku,
      productName: (c[iName] ?? "").trim(),
      quantity: Number(c[iQty] ?? 0) || 0,
      bins: Number(c[iBins] ?? 0) || 0,
    };
    bySku.set(sku, row);
    const stem = sku.split("-").slice(0, -1).join("-");
    if (stem) qtyByStem.set(stem, (qtyByStem.get(stem) ?? 0) + row.quantity);
  }
  return { bySku, qtyByStem, source: path.basename(file), rows: bySku.size };
}

/** Total quantity the warehouse holds under a colourway SKU. Null when absent. */
export function pioQuantityFor(pio: PioIndex | null, colorwaySku: string): number | null {
  if (!pio) return null;
  const key = normalizeSku(colorwaySku);
  if (pio.qtyByStem.has(key)) return pio.qtyByStem.get(key)!;
  const exact = pio.bySku.get(key);
  return exact ? exact.quantity : null;
}
