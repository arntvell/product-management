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

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
