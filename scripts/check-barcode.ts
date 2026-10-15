// Pure-function checks for barcode identity vs spelling. No database, no
// network — run it with a dummy connection string, since apply-barcodes
// constructs a Prisma client at import time but nothing here touches it:
//
//   ORIGO_POSTGRES_PRISMA_URL='postgresql://u:p@127.0.0.1:1/none' \
//     npx tsx scripts/check-barcode.ts
//
// A 12-digit UPC-A and the same code with a leading zero are ONE barcode, but
// the zero-padded spelling does not scan at the till (Pantherella, 2026-09-23).
// These pin both halves: never two garments on one code, and a zero can be
// dropped but never silently added.
import {
  barcodeKey,
  barcodeSpellings,
  channelNeedsBarcode,
  cleanBarcode,
  gtinCheckDigit,
  isInternalRange,
  rejectionReason,
  storedForm,
} from "@/lib/master/barcode";
import { planOnce } from "@/lib/master/apply-barcodes";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
};

const UPC = "884597234150"; // Pantherella Agatha Cream OS
const UPC0 = "0" + UPC;
const EAN = "7072536000017"; // Livid's own range

// --- identity ---------------------------------------------------------------
eq("UPC-A and its zero-padded form share one key", barcodeKey(UPC), barcodeKey(UPC0));
eq("the key is the 13-digit form", barcodeKey(UPC), UPC0);
eq("an EAN-13 is its own key", barcodeKey(EAN), EAN);
eq("invisible formatting is stripped", barcodeKey(`‭${EAN}‬`), EAN);
eq("a bad check digit is not a barcode", barcodeKey("884597234151"), null);
eq("a zero placeholder is not a barcode", barcodeKey("0"), null);
eq("a 9-digit code is not a barcode", barcodeKey("123456789"), null);

// --- spelling ---------------------------------------------------------------
eq("a 12-digit UPC-A is stored as 12", storedForm(UPC), UPC);
eq("a zero-padded UPC-A is stored as 12", storedForm(UPC0), UPC);
eq("a Livid EAN-13 is untouched", storedForm(EAN), EAN);
eq("stored form of junk is null", storedForm("******mangler"), null);
eq("cleanBarcode keeps the spelling it was given (13)", cleanBarcode(UPC0), UPC0);
eq("cleanBarcode keeps the spelling it was given (12)", cleanBarcode(UPC), UPC);
eq("lookups search both spellings of a UPC-A", barcodeSpellings(UPC), [UPC0, UPC]);
eq("lookups search one spelling of an EAN-13", barcodeSpellings(EAN), [EAN]);
eq("rejectionReason still explains a bad check digit",
  rejectionReason("884597234151"), "fails its EAN-13 check digit (expected 0, got 1)");
eq("rejectionReason accepts a UPC-A", rejectionReason(UPC), null);
eq("isInternalRange sees past the padding zero", isInternalRange("0" + "212345678900"), true);

// --- channels: drop a zero, never add one -------------------------------------
eq("channel 0+12, master 12 -> rewrite (drop the zero)", channelNeedsBarcode(UPC0, UPC), true);
eq("channel 12, master 0+12 (legacy) -> leave it", channelNeedsBarcode(UPC, UPC0), false);
eq("channel and master agree on 0+12 -> leave it", channelNeedsBarcode(UPC0, UPC0), false);
eq("channel and master agree on 12 -> leave it", channelNeedsBarcode(UPC, UPC), false);
eq("a different barcode -> rewrite", channelNeedsBarcode(EAN, UPC), true);
eq("channel empty -> write", channelNeedsBarcode(null, UPC), true);
eq("channel junk -> write", channelNeedsBarcode("******mangler", UPC), true);
eq("master not a barcode -> never write", channelNeedsBarcode(UPC0, "123"), false);

// --- the master plan ------------------------------------------------------------
type V = { variantSku: string; barcode: string | null };
const plan = (
  corrections: Array<{ variantSku: string; barcode: string }>,
  variants: V[],
  opts: { overwrite?: boolean; reformat?: boolean } = {}
) => {
  const bySku = new Map(variants.map((v) => [v.variantSku, v]));
  const holder = new Map<string, string>();
  for (const v of variants) {
    const k = barcodeKey(v.barcode);
    if (k) holder.set(k, v.variantSku);
  }
  return planOnce(corrections, bySku, holder, new Set(corrections.map((c) => c.variantSku)), opts);
};

// The editor bug: 12 typed over 0+12 read as "unchanged".
const respell = plan([{ variantSku: "A", barcode: UPC }], [{ variantSku: "A", barcode: UPC0 }], {
  overwrite: true,
  reformat: true,
});
eq("editor: 12 over 0+12 is a change, not a no-op", respell.change, [{ variantSku: "A", from: UPC0, to: UPC }]);
eq("editor: re-spelling its own code is not a collision", respell.collisions, []);

const typedWithZero = plan([{ variantSku: "A", barcode: UPC0 }], [{ variantSku: "A", barcode: UPC0 }], {
  overwrite: true,
  reformat: true,
});
eq("editor: 0+12 typed over 0+12 still drops the zero", typedWithZero.change, [{ variantSku: "A", from: UPC0, to: UPC }]);

const alreadyTwelve = plan([{ variantSku: "A", barcode: UPC0 }], [{ variantSku: "A", barcode: UPC }], {
  overwrite: true,
  reformat: true,
});
eq("editor: never adds a zero back", [alreadyTwelve.change, alreadyTwelve.unchanged], [[], 1]);

// A bulk list must not migrate legacy rows by spelling them differently.
const bulk = plan([{ variantSku: "A", barcode: UPC0 }], [{ variantSku: "A", barcode: UPC0 }]);
eq("bulk: a legacy 0+12 row is left alone without reformat", [bulk.change, bulk.unchanged], [[], 1]);
const bulkNoOverwrite = plan([{ variantSku: "A", barcode: UPC }], [{ variantSku: "A", barcode: UPC0 }]);
eq("bulk: same code, other spelling is unchanged, not an overwrite refusal",
  [bulkNoOverwrite.rejected, bulkNoOverwrite.unchanged], [[], 1]);

// One code, two garments, across spellings.
const clash = plan(
  [{ variantSku: "B", barcode: UPC }],
  [{ variantSku: "A", barcode: UPC0 }, { variantSku: "B", barcode: null }]
);
eq("a UPC-A held zero-padded by another variant is a collision",
  clash.collisions, [{ variantSku: "B", barcode: UPC, heldBy: "A" }]);
eq("...and nothing is filled", clash.fill, []);

const twoClaims = plan(
  [{ variantSku: "A", barcode: UPC }, { variantSku: "B", barcode: UPC0 }],
  [{ variantSku: "A", barcode: null }, { variantSku: "B", barcode: null }]
);
eq("two edits claiming one code in two spellings clash", twoClaims.collisions.length, 1);

const fill = plan([{ variantSku: "A", barcode: UPC0 }], [{ variantSku: "A", barcode: null }]);
eq("a fill is stored in 12 digits", fill.fill, [{ variantSku: "A", to: UPC }]);

const junk = plan([{ variantSku: "A", barcode: UPC }], [{ variantSku: "A", barcode: "******mangler" }]);
eq("a held non-barcode counts as blank: filled without overwrite", junk.fill, [{ variantSku: "A", to: UPC }]);

// ---------------------------------------------------------------------------
// EAN-8 and GTIN-14 (2026-10-15)
//
// An external product's barcode is the supplier's, printed on the garment, and
// the lengths were widened from 12/13 so that receiving a delivery does not stop
// on a code the warehouse is physically holding.
//
// The expected check digits below are worked out by hand against the GS1 rule
// (weights 3,1 alternating leftwards from the last data digit), not read back
// out of `gtinCheckDigit` — otherwise these would assert only that the function
// agrees with itself.
// ---------------------------------------------------------------------------

const EAN8 = "96385074"; // the GS1 specimen; data 9638507, check 4
eq("an EAN-8 is accepted", rejectionReason(EAN8), null);
eq("an EAN-8 keys as itself", barcodeKey(EAN8), EAN8);
eq("an EAN-8 has one spelling", barcodeSpellings(EAN8), [EAN8]);
eq("gtinCheckDigit agrees on the EAN-8", gtinCheckDigit("9638507"), "4");

// The zero a UPC-A drops is NOT the zero an EAN-8 starts with.
const EAN8_ZERO = "01234565"; // data 0123456 -> 45 -> check 5
eq("an EAN-8 beginning with zero is accepted", rejectionReason(EAN8_ZERO), null);
eq("...and keeps all eight digits in its stored form", storedForm(EAN8_ZERO), EAN8_ZERO);
eq("...and is not re-spelled to seven", barcodeSpellings(EAN8_ZERO), [EAN8_ZERO]);

// A GTIN is invariant under left-padding with zeros, so a 14-wide spelling of a
// UPC-A is the SAME barcode and has to compare equal to it.
const UPC_14 = "00" + UPC; // 00884597234150
eq("a zero-padded GTIN-14 is accepted", rejectionReason(UPC_14), null);
eq("...and collapses to the 13-digit key", barcodeKey(UPC_14), UPC0);
eq("...so it stores as the UPC-A the master already holds", storedForm(UPC_14), UPC);
eq("...and is found under both spellings", barcodeSpellings(UPC_14), [UPC0, UPC]);
eq("...and does not read as a change", channelNeedsBarcode(UPC, UPC_14), false);

// A 14 with a non-zero indicator digit is an outer carton, not this garment. It
// is kept rather than refused, but it keeps its own identity.
const CARTON = "10884597234157"; // data 1088459723415 -> 123 -> check 7
eq("a true GTIN-14 is accepted", rejectionReason(CARTON), null);
eq("...and keeps its own key", barcodeKey(CARTON), CARTON);
eq("...which is not the garment's", barcodeKey(CARTON) === barcodeKey(UPC), false);

// What widening the lengths must NOT readmit. This is the value the digitsOf
// comment used to cite as the reason every 14 was refused.
eq(
  "the production 14-digit junk is still refused",
  rejectionReason("70903847293742"),
  "fails its GTIN-14 check digit (expected 3, got 2)"
);
eq("...and keys as nothing", barcodeKey("70903847293742"), null);
eq("a 9-digit code is still refused", barcodeKey("123456789"), null);
eq(
  "...with a message naming the lengths that work",
  rejectionReason("123456789"),
  "is 9 digits — a barcode is 8 (EAN-8), 12 (UPC-A), 13 (EAN-13) or 14 (GTIN-14) digits"
);
eq("a single digit is still refused", barcodeKey("7"), null);
eq("a bad EAN-8 check digit is refused", rejectionReason("96385075"), "fails its EAN-8 check digit (expected 4, got 5)");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
