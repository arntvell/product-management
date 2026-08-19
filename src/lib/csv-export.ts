// CSV export for the products view. Exports the currently filtered list with
// the core product fields, price, and every custom.* metafield (human labels),
// so the file opens cleanly in Excel / Google Sheets.
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { Product } from "@/types";

// Escape a single CSV field per RFC 4180: wrap in quotes when it contains a
// comma, quote, or newline, and double any embedded quotes.
function csvField(value: string): string {
  const v = value ?? "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const CORE_COLUMNS: { header: string; get: (p: Product) => string }[] = [
  { header: "Title", get: (p) => p.title },
  { header: "Handle", get: (p) => p.handle },
  { header: "Vendor", get: (p) => p.vendor },
  { header: "Product Type", get: (p) => p.productType },
  { header: "Status", get: (p) => p.status },
  { header: "Tags", get: (p) => p.tags.join(", ") },
  { header: "Price", get: (p) => p.variants[0]?.price ?? "" },
  { header: "Compare At Price", get: (p) => p.variants[0]?.compareAtPrice ?? "" },
  { header: "Media Count", get: (p) => String(p.mediaCount) },
];

export function productsToCsv(products: Product[]): string {
  const headers = [
    ...CORE_COLUMNS.map((c) => c.header),
    ...METAFIELD_DEFINITIONS.map((d) => d.label),
  ];

  const rows = products.map((p) => [
    ...CORE_COLUMNS.map((c) => csvField(c.get(p))),
    ...METAFIELD_DEFINITIONS.map((d) => csvField(p.metafields[d.key] ?? "")),
  ]);

  return [headers.map(csvField).join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

// Trigger a client-side download of the given products as a CSV file.
export function downloadProductsCsv(products: Product[], filename: string): void {
  const csv = productsToCsv(products);
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
}
