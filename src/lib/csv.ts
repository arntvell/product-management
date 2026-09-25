// CSV, in one place.
//
// This repo had three implementations at three levels of rigour: a correct
// writer in csv-export.ts, a proper quoted-field reader in pio.ts that only
// handled one line at a time, and a `line.split(",")` in import-gaps.ts that
// would shift every column the first time a value contained a comma. The reader
// here is the pio.ts scanner promoted to whole-text, which is what a cell pasted
// out of Excel needs — a newline inside quotes is legal and silently destroys a
// per-line parser.

/** RFC 4180: quote when the value contains a comma, quote or newline. */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  // CRLF, because Excel is the destination and it is the format Excel writes.
  return lines.join("\r\n");
}

/**
 * Parse a whole CSV document, honouring quoted fields and newlines inside them.
 *
 * Returns rows of raw strings; the caller decides what a header is.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // A leading BOM is what Excel writes back out, and it would otherwise become
  // part of the first header.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // swallow; the \n that follows ends the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Rows keyed by header name, which is what every importer here actually wants. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = (r[i] ?? "").trim()));
    return rec;
  });
}

/** UTF-8 BOM so Excel reads æ/ø/å correctly rather than as mojibake. */
export const UTF8_BOM = "﻿";
