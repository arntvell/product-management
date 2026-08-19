// CSV export for the products view. Exports the currently filtered list with
// ONE ROW PER VARIANT (so each size's SKU and price is its own line), the core
// product fields, and every custom.* metafield (human labels). Opens cleanly in
// Excel / Google Sheets.
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { Product, ProductVariant } from "@/types";

// Escape a single CSV field per RFC 4180: wrap in quotes when it contains a
// comma, quote, or newline, and double any embedded quotes.
function csvField(value: string): string {
  const v = value ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Column getters receive the product and the current variant (null when a
// product has no variants — it still gets one row with empty variant fields).
const COLUMNS: { header: string; get: (p: Product, v: ProductVariant | null) => string }[] = [
  { header: "Title", get: (p) => p.title },
  { header: "Handle", get: (p) => p.handle },
  { header: "SKU", get: (_p, v) => v?.sku ?? "" },
  { header: "Vendor", get: (p) => p.vendor },
  { header: "Product Type", get: (p) => p.productType },
  { header: "Status", get: (p) => p.status },
  { header: "Tags", get: (p) => p.tags.join(", ") },
  { header: "Price", get: (_p, v) => v?.price ?? "" },
  { header: "Compare At Price", get: (_p, v) => v?.compareAtPrice ?? "" },
  { header: "Media Count", get: (p) => String(p.mediaCount) },
];

export function productsToCsv(products: Product[]): string {
  const headers = [
    ...COLUMNS.map((c) => c.header),
    ...METAFIELD_DEFINITIONS.map((d) => d.label),
  ];

  const rows: string[][] = [];
  for (const p of products) {
    // Products with no variants still produce a single row.
    const variants: (ProductVariant | null)[] =
      p.variants.length > 0 ? p.variants : [null];
    for (const v of variants) {
      rows.push([
        ...COLUMNS.map((c) => csvField(c.get(p, v))),
        ...METAFIELD_DEFINITIONS.map((d) => csvField(p.metafields[d.key] ?? "")),
      ]);
    }
  }

  return [headers.map(csvField).join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

// Trigger a client-side download of the given products as a CSV file.
// Returns the number of data rows written (one per variant).
export function downloadProductsCsv(products: Product[], filename: string): number {
  const csv = productsToCsv(products);
  const rowCount = products.reduce((n, p) => n + Math.max(p.variants.length, 1), 0);
  // BOM so Excel detects UTF-8 (correct æ/ø/å etc.).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return rowCount;
}
