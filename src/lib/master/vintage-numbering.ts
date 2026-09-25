// Item numbers and barcodes for online vintage.
//
// Neither is chosen. The spreadsheet holds a pre-assigned table of item numbers
// against barcodes running far ahead of what has been used — 13763 to 15021 are
// sitting there unattributed today — and those codes may already be on printed
// labels. So nothing here ALLOCATES: it reproduces a pairing that already
// exists.
//
// The pairing is arithmetic. Every one of the sheet's 13,909 barcoded rows
// satisfies `barcode = EAN13(offset + itemNumber)` for one of two offsets, with
// a valid check digit, and the eras split cleanly at item 10022:
//
//   items    1112 .. 10021   offset 701234499978   (the 7012345 range)
//   items   10022 .. 15021   offset 699999992486   (the 7000000 range)
//
// Checked against the master as well: of 2,084 live VN-ONLN barcodes, 2,058
// match the formula. All 26 that do not are below item 1112 — legacy rows that
// predate the pairing, the same band whose variant SKUs also lack the `-OS`
// suffix. Nothing at or above 10022 disagrees, so new drops are safe.
import type { PrismaClient } from "@/generated/prisma/client";
import { checkDigit } from "./barcode";

/** Where the modern range begins. Below this, the older 7012345 offset applies. */
const MODERN_ERA_FROM = 10022;
const OFFSET_MODERN = 699999992486;
const OFFSET_LEGACY = 701234499978;

/**
 * The last item number the sheet has a barcode for. Beyond this the pairing is
 * an extrapolation rather than a record, which is a different thing and should
 * be a deliberate decision — hence `barcodeForItemNumber` warns rather than
 * silently inventing codes.
 */
export const LAST_PREASSIGNED_ITEM = 15021;

/** The barcode that belongs to an item number. */
export function barcodeForItemNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`Item number must be a positive integer, got ${n}`);
  const base = String((n >= MODERN_ERA_FROM ? OFFSET_MODERN : OFFSET_LEGACY) + n);
  return base + checkDigit(base);
}

/** True when the number is inside the range the sheet actually pre-assigned. */
export function isPreassigned(n: number): boolean {
  return n >= MODERN_ERA_FROM && n <= LAST_PREASSIGNED_ITEM;
}

/** `VN-ONLN-13763` — style and colourway both. */
export function itemSku(n: number | string): string {
  return `VN-ONLN-${String(n).trim()}`;
}

/** `VN-ONLN-13763-OS` — the variant, carrying the size token. */
export function itemVariantSku(n: number | string): string {
  return `${itemSku(n)}-OS`;
}

/** `13763-vintage` — the storefront address. */
export function itemHandle(n: number | string): string {
  return `${String(n).trim()}-vintage`.toLowerCase();
}

export interface NextNumbers {
  numbers: number[];
  /** Item numbers past the sheet's pre-assigned range, if the drop ran over. */
  beyondPreassigned: number[];
  highestUsed: number;
  highestInMaster: number;
  highestOnShopify: number;
  /** Set when the master is behind the store — see below. */
  warning: string | null;
}

/**
 * The next `count` free item numbers.
 *
 * Numbers are never reused, so the floor is the highest ever taken — a gap in
 * the middle is a garment that was written up and withdrawn, and its barcode
 * may still be on a label.
 *
 * THE MASTER IS NOT THE AUTHORITY HERE, which is the trap this function exists
 * to avoid. Origio's highest is 13682, the end of drop 184; drops 185 and 186
 * were run from the spreadsheet and never imported, so the store has garments
 * up to 13762 that Origio has never heard of. Taking the master's word would
 * hand drop 187 the number 13683 — already live, already labelled, and the SKU
 * collision would only surface at the push.
 *
 * So the floor is the higher of what the master holds and what Shopify has
 * published, and the caller is told when they disagree.
 */
export async function nextItemNumbers(
  prisma: PrismaClient,
  count: number,
  opts: { highestOnShopify?: number } = {}
): Promise<NextNumbers> {
  const rows = await prisma.$queryRawUnsafe<{ max: number | null }[]>(
    `select max((regexp_match("colorwaySku", '^VN-ONLN-(\\d+)$'))[1]::int) as max
       from "Colorway" where "colorwaySku" ~ '^VN-ONLN-\\d+$'`
  );
  const highestInMaster = rows[0]?.max ?? 0;
  const highestOnShopify = opts.highestOnShopify ?? 0;
  const highestUsed = Math.max(highestInMaster, highestOnShopify);

  const numbers = Array.from({ length: count }, (_, i) => highestUsed + 1 + i);
  return {
    numbers,
    beyondPreassigned: numbers.filter((n) => n > LAST_PREASSIGNED_ITEM),
    highestUsed,
    highestInMaster,
    highestOnShopify,
    warning:
      highestOnShopify > highestInMaster
        ? `Shopify has vintage up to ${highestOnShopify} but the master stops at ${highestInMaster} — ` +
          `${highestOnShopify - highestInMaster} garment(s) were published from the spreadsheet and never ` +
          `imported. Numbering from ${numbers[0]} to stay clear of them.`
        : null,
  };
}

/**
 * Record the barcodes a drop used in the allocation ledger.
 *
 * These were never drawn from `allocate()` — they came off the sheet's
 * pre-assigned table — but the ledger is the master's record of what has been
 * issued, and a code missing from it is a code `allocate()` could hand out
 * again. `recordIssued` is idempotent, so re-running a drop is harmless.
 *
 * Note the ledger currently knows only 74 of the ~1,456 `7000000` codes in use,
 * so its high-water mark for that range is far behind reality. Writing these in
 * closes the gap going forward; the back catalogue is a separate backfill.
 */
export async function recordDropBarcodes(
  prisma: PrismaClient,
  items: Array<{ itemNumber: number | string; barcode: string }>,
  drop: string
): Promise<{ recorded: number; skipped: number }> {
  const { recordIssued } = await import("./barcode");
  return recordIssued(
    prisma,
    items.map((i) => ({
      barcode: i.barcode,
      sku: itemVariantSku(i.itemNumber),
      authority: `vintage-drop-${drop}`,
    }))
  );
}
