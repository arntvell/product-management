// Barcode identity: canonical form, validation, and allocation.
//
// Every Livid barcode is `range + zero-padded sequence + EAN-13 check digit`.
// That was verified against all 9,822 rows of the CFO list (2026-09-11) with
// zero mismatches, so allocation is a counter and nothing more exotic.
//
// Two series run in parallel:
//   7072536  production        high-water mark 12,257 at time of writing
//   7000000  non-production    samples, sale buckets, EXT-IMP-MISC
//
// The ledger (BarcodeAllocation) is the record of what has been issued. It
// exists so `Variant.barcode @unique` has something to check against *before* a
// value reaches a garment, rather than discovering a collision in reconciliation
// months later.

import type { PrismaClient } from "@/generated/prisma/client";

/** Livid's GS1 prefix — real, registered. */
export const RANGE_PRODUCTION = "7072536";
/** Internal series for rows that never get a GS1 code: samples, buckets, repairs. */
export const RANGE_INTERNAL = "7000000";

export const KNOWN_RANGES = [RANGE_PRODUCTION, RANGE_INTERNAL] as const;
export type BarcodeRange = (typeof KNOWN_RANGES)[number];

/**
 * GS1 modulo-10 check digit over the first 12 digits of an EAN-13.
 * Weights alternate 1,3 starting at 1 for the leftmost digit.
 */
export function checkDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return checkDigit(value.slice(0, 12)) === value[12];
}

// Two questions, two answers.
//
// A barcode has an IDENTITY and a SPELLING. A 12-digit UPC-A and the same code
// with a leading zero are one barcode: a scanner reads the same bars. But they
// are two spellings, and the business found on 2026-09-23 that the zero-padded
// one fails at the till — 28 Pantherella variants had to be stripped back to 12
// digits by hand in all four systems.
//
//   "Does anything else hold this code?"   compare barcodeKey()  — identity
//   "Is this value different from that?"   compare the strings    — spelling
//
// Every collision map, duplicate check and link join keys by barcodeKey(), so
// `884597234150` and `0884597234150` can never sit on two garments. Every
// "changed / unchanged / agrees" decision compares spellings, or a zero could
// never be dropped: the two forms share a key, so a key comparison calls the
// edit a no-op.
//
// The master holds both spellings today — 416 zero-prefixed 13-digit rows and
// 211 twelve-digit ones (2026-09-23) — and they are NOT migrated: a channel
// may hold the zero-prefixed code and scan it fine. So:
//
//   inbound   a NEW value is stored as storedForm(): a UPC-A as 12 digits.
//   outbound  the master's own spelling is sent as it is. Never re-derived:
//             storedForm() on the way out would strip every legacy row in the
//             channel on its next push.
//
// `Variant.barcode @unique` compares strings, so it cannot see the two forms
// as one. Every writer checks by barcodeKey() before writing; a unique index on
// the key itself is in docs/upc-stored-form-2026-09-23.md, not yet applied.

/** Formatting stripped, digits only; null when it is not a usable EAN-13/UPC-A. */
function digitsOf(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Strip Unicode format characters (category Cf: LRM/RLM/LRO/PDF, ZWSP, BOM).
  const stripped = raw.replace(/[\p{Cf}\s]/gu, "");
  if (!stripped) return null;
  if (!/^\d+$/.test(stripped)) return null;
  // Placeholder values that mean "no barcode".
  if (/^0+$/.test(stripped)) return null;
  if (stripped.length === 12) return isValidEan13("0" + stripped) ? stripped : null;
  if (stripped.length === 13) return isValidEan13(stripped) ? stripped : null;
  // 9-digit codes (~60 of them, consistent across three systems), the 14-digit
  // 70903847293742, single digits 1-7. All real values in production data, none
  // of them EANs. They belong in a different field, not this one.
  return null;
}

/**
 * A barcode's identity: its 13-digit EAN-13 form. Compare these to ask whether
 * two values are the same barcode — never to decide what to store or send.
 *
 * Two real-world problems this solves, both of which produced phantom conflicts
 * during the 2026-09-11 reconciliation:
 *
 *  - Invisible formatting characters. Sitoo, Shopify and Cin7 all hold
 *    `‭7350141350025‬`, which is unequal to the same digits typed
 *    cleanly. 21 "conflicts" were this.
 *  - UPC-A vs EAN-13. A 12-digit UPC-A and its 13-digit form are the same
 *    barcode; the EAN-13 is the UPC-A with a leading zero.
 *
 * Returns null for anything that is not a barcode — empty strings, the literal
 * placeholder "0", and free text like "******************mangler" (Norwegian
 * for "missing", found in production data in two systems).
 */
export function barcodeKey(raw: string | null | undefined): string | null {
  const d = digitsOf(raw);
  if (!d) return null;
  return d.length === 12 ? "0" + d : d;
}

/**
 * The spelling the master stores for a NEW value: a UPC-A as its 12 digits,
 * whichever form it arrived in; an EAN-13 as itself. Null when not a barcode.
 */
export function storedForm(raw: string | null | undefined): string | null {
  const key = barcodeKey(raw);
  if (!key) return null;
  return key.startsWith("0") ? key.slice(1) : key;
}

/**
 * The value as given, validated and cleaned but not re-spelled. What goes out
 * to a channel: the master's own spelling, so a legacy zero-prefixed row stays
 * as the channel already has it.
 */
export function cleanBarcode(raw: string | null | undefined): string | null {
  return digitsOf(raw);
}

/**
 * Every spelling one barcode can be stored under — for `barcode: { in: … }`
 * lookups, which compare strings. One entry for an EAN-13, two for a UPC-A.
 */
export function barcodeSpellings(raw: string | null | undefined): string[] {
  const key = barcodeKey(raw);
  if (!key) return [];
  return key.startsWith("0") ? [key, key.slice(1)] : [key];
}

/**
 * Should a channel holding `live` be rewritten to the master's `master`?
 *
 * A different barcode, always. The same barcode in another spelling, only to
 * DROP a zero the master no longer carries — never to add one. A channel that
 * already holds the 12 digits is the form that scans, and the master's legacy
 * zero-prefixed rows are not migrated (see the note at the top).
 */
export function channelNeedsBarcode(
  live: string | null | undefined,
  master: string | null | undefined
): boolean {
  const m = digitsOf(master);
  if (!m) return false;
  const l = digitsOf(live);
  if (!l) return true;
  if (barcodeKey(l) !== barcodeKey(m)) return true;
  return m.length === 12 && l.length === 13;
}

/** Why `barcodeKey` rejected a value — for user-facing validation messages. */
export function rejectionReason(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === "") return null; // absent is allowed
  const stripped = String(raw).replace(/[\p{Cf}\s]/gu, "");
  if (!stripped) return "contains only invisible formatting characters";
  if (!/^\d+$/.test(stripped)) return "contains non-digit characters";
  if (/^0+$/.test(stripped)) return "is a zero placeholder, not a barcode";
  if (stripped.length !== 12 && stripped.length !== 13) {
    return `is ${stripped.length} digits — an EAN-13 is 13 (or a 12-digit UPC-A)`;
  }
  const candidate = stripped.length === 12 ? "0" + stripped : stripped;
  if (!isValidEan13(candidate)) {
    return `fails its EAN-13 check digit (expected ${checkDigit(candidate.slice(0, 12))}, got ${candidate[12]})`;
  }
  return null;
}

/** Build the full EAN-13 for a sequence number in a range. */
export function barcodeFor(range: string, sequence: number): string {
  const width = 12 - range.length;
  const body = String(sequence).padStart(width, "0");
  if (body.length > width) {
    throw new Error(`sequence ${sequence} overflows range ${range} (max ${"9".repeat(width)})`);
  }
  const first12 = range + body;
  return first12 + checkDigit(first12);
}

/** Split a barcode (either spelling) back into its range and sequence, if we own it. */
export function parseAllocation(
  barcode: string
): { range: BarcodeRange; sequence: number } | null {
  for (const range of KNOWN_RANGES) {
    if (barcode.startsWith(range)) {
      return { range, sequence: Number(barcode.slice(range.length, 12)) };
    }
  }
  return null;
}

/**
 * Is this a restricted-circulation code rather than a real GS1 article number?
 *
 * GS1 reserves prefix 2 for in-store / variable-measure use and 99 for coupons.
 * Codes in those ranges are printed by the retailer, not the manufacturer, and
 * they exist only where they were printed — 57 of Sitoo's barcodes are in these
 * ranges and 16 appear nowhere else.
 *
 * This matters because such a code is the one that actually SCANS at the till.
 * Overwriting it with the manufacturer's EAN is not a correction; it breaks the
 * shop. Both values are right, for different questions, and the master has one
 * slot for them.
 */
export function isInternalRange(barcode: string): boolean {
  // A converted UPC-A carries a leading zero that is not part of the prefix.
  const core = barcode.length === 13 && barcode.startsWith("0") ? barcode.slice(1) : barcode;
  return core.startsWith("2") || core.startsWith("99");
}

export interface AllocateOptions {
  range?: string;
  sku?: string;
  authority?: string;
  count?: number;
}

/**
 * Issue the next barcode(s) in a range and record them in the ledger.
 *
 * Serialised so two concurrent creates cannot draw the same number: the ledger's
 * @@unique([range, sequence]) makes a collision an error rather than a silent
 * reissue, and the advisory lock makes it not happen in the first place.
 */
export async function allocate(
  prisma: PrismaClient,
  opts: AllocateOptions = {}
): Promise<string[]> {
  const range = opts.range ?? RANGE_PRODUCTION;
  const count = opts.count ?? 1;
  if (count < 1) return [];

  return prisma.$transaction(async (tx) => {
    // One writer per range at a time. The key is derived from the range so the
    // two series do not block each other.
    const lockKey = Number(range.slice(-6));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

    const top = await tx.barcodeAllocation.findFirst({
      where: { range },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const start = (top?.sequence ?? 0) + 1;

    const rows = Array.from({ length: count }, (_, i) => ({
      range,
      sequence: start + i,
      barcode: barcodeFor(range, start + i),
      sku: opts.sku ?? null,
      authority: opts.authority ?? "origio",
    }));
    await tx.barcodeAllocation.createMany({ data: rows });
    return rows.map((r) => r.barcode);
  });
}

/**
 * Record barcodes that were issued elsewhere (Threadflow, the CFO list) so the
 * ledger's high-water mark stays ahead of them and `allocate` never reissues.
 * Idempotent — re-running with the same rows is a no-op.
 */
export async function recordIssued(
  prisma: PrismaClient,
  entries: Array<{ barcode: string; sku?: string | null; authority: string }>
): Promise<{ recorded: number; skipped: number }> {
  const rows: Array<{
    range: string;
    sequence: number;
    barcode: string;
    sku: string | null;
    authority: string;
  }> = [];
  let skipped = 0;

  for (const e of entries) {
    const bc = barcodeKey(e.barcode);
    const parsed = bc ? parseAllocation(bc) : null;
    if (!bc || !parsed) {
      // Not ours to track — an external brand's own GS1 prefix, or malformed.
      skipped++;
      continue;
    }
    rows.push({
      range: parsed.range,
      sequence: parsed.sequence,
      barcode: bc,
      sku: e.sku ?? null,
      authority: e.authority,
    });
  }

  const res = await prisma.barcodeAllocation.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return { recorded: res.count, skipped };
}
