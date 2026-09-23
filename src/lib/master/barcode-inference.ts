// Inferring a missing barcode from the gaps in a size run.
//
// Barcodes are allocated sequentially along a size run, so a missing one often
// has exactly one number that can possibly fill it:
//
//   EXT-NOV-GAT-BLK-40   8585052170199
//   EXT-NOV-GAT-BLK-41   ← missing, and Cin7 held the WHITE shoe's code here
//   EXT-NOV-GAT-BLK-42   8585052170212
//
// Between 858505217019 and 858505217021 sits one integer, 858505217020, whose
// EAN-13 is 8585052170205. One missing size, one free number: the answer is
// forced rather than guessed.
//
// This is still an INFERENCE. It reads a pattern in the neighbours, not a fact
// about the garment, so nothing here writes. It produces candidates for a person
// to confirm against the box or the brand.

import { prisma } from "@/lib/db";
import { barcodeKey, checkDigit } from "./barcode";

export type InferenceConfidence = "forced" | "likely";

/**
 * A barcode that does not fit the sequence its siblings follow.
 *
 * The same reasoning that fills a gap also detects a wrong value, and that turns
 * out to be the more useful half. EXT-NOV-GAT-BLK-41 carries 8585052170441 —
 * which belongs to the WHITE shoe — sitting between 8585052170199 and
 * 8585052170212. It is not a gap, so gap-filling never sees it; it is an
 * intruder in an otherwise clean run.
 */
export interface OutOfSequence {
  variantId: string;
  variantSku: string;
  colorwaySku: string;
  held: string;
  /** What the sequence says it should be, when that is forced. */
  expected: string | null;
  reason: string;
}

export interface BarcodeCandidate {
  variantId: string;
  variantSku: string;
  colorwaySku: string;
  proposed: string;
  confidence: InferenceConfidence;
  reason: string;
  /** The neighbours the inference rests on, in size order. */
  basis: Array<{ variantSku: string; barcode: string | null }>;
}

/** EAN-13 for a 12-digit core. */
function ean(core: string): string {
  return core + checkDigit(core);
}

/**
 * Size order for a run.
 *
 * Numeric where the label is numeric (shoe sizes, waists), otherwise the
 * conventional clothing order. Anything unrecognised sorts last and is excluded
 * from inference rather than guessed at.
 */
const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL"];

function sizeRank(label: string): number | null {
  const t = label.trim().toUpperCase();
  const n = Number(t.replace(",", "."));
  if (Number.isFinite(n)) return n;
  const i = LETTER_ORDER.indexOf(t);
  return i === -1 ? null : i;
}

export interface RunVariant {
  id: string;
  variantSku: string;
  sizeLabel: string;
  barcode: string | null;
}

/**
 * Candidates for one colourway's size run.
 *
 * Requires the barcoded neighbours to be strictly increasing with size — if they
 * are not, the run was not allocated sequentially and the gap says nothing.
 */
/**
 * Barcodes that break their run's sequence.
 *
 * Requires most of the run to agree on a prefix and an order, so a single odd
 * value stands out against its siblings rather than the other way round.
 */
export function outOfSequenceForRun(
  colorwaySku: string,
  variants: RunVariant[]
): OutOfSequence[] {
  // Order-agnostic on purpose.
  //
  // An earlier version assumed barcodes ascend with size and flagged 56 runs,
  // most of them wrongly. Real allocations do not agree on an order:
  //
  //   LIV-HYD-T-WHT   ascends in ALPHABETICAL label order — L, M, S, XL, XS
  //   EXT-KEEN-JAS    DESCENDS with size — 37 is …005421, 45 is …005322
  //   LIV-TCN-WHT     ascends alphabetically too
  //
  // What every genuine run does share is density: its barcodes are consecutive
  // or near-consecutive numbers, whatever order they were handed out in. So the
  // test is distance from the cluster, not position in a sequence. That flags
  // EXT-NOV-GAT-BLK-41 — sitting at …0441 among …0199 to …0250 — and leaves
  // every legitimately-ordered run alone.
  const rows = variants
    .map((v) => ({ ...v, canon: barcodeKey(v.barcode) }))
    .filter((v) => v.canon);
  if (rows.length < 4) return [];

  const prefixes = new Map<string, number>();
  for (const r of rows) {
    const p = r.canon!.slice(0, 7);
    prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
  }
  const [mainPrefix, mainCount] = [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0];
  // One odd prefix in an otherwise uniform run is itself the finding.
  if (mainCount < rows.length - 1) return [];

  const core = (b: string) => Number(b.slice(0, 12));

  const out: OutOfSequence[] = [];
  for (const r of rows) {
    const others = rows.filter((o) => o !== r).map((o) => core(o.canon!));
    const nearest = Math.min(...others.map((o) => Math.abs(o - core(r.canon!))));
    const lo = Math.min(...others);
    const hi = Math.max(...others);
    // The test is relative to the run's own width, not an absolute distance.
    // A fixed floor gets this wrong in both directions: EXT-NOV-GAT-BLK-41 sits
    // only 19 numbers from its siblings, which any sensible floor would ignore —
    // but its siblings span just 6 numbers, so 19 is three runs away.
    const spread = hi - lo;
    const wrongPrefix = !r.canon!.startsWith(mainPrefix);
    if (!wrongPrefix && nearest <= Math.max(3, spread)) continue;

    // When the cluster leaves exactly one free number where this size belongs,
    // name it. Otherwise say only that the value does not belong.
    const cluster = [...others].sort((a, b) => a - b);
    const free: number[] = [];
    for (let n = lo; n <= hi && free.length < 3; n++) if (!cluster.includes(n)) free.push(n);
    const expected = free.length === 1 ? ean(String(free[0]).padStart(12, "0")) : null;

    out.push({
      variantId: r.id,
      variantSku: r.variantSku,
      colorwaySku,
      held: r.canon!,
      expected,
      reason: wrongPrefix
        ? `prefix ${r.canon!.slice(0, 7)} against ${mainPrefix} on the rest of the run`
        : `${nearest} away from the nearest sibling; the run otherwise spans ${lo}-${hi}`,
    });
  }
  return out;
}

export function inferForRun(colorwaySku: string, variants: RunVariant[]): BarcodeCandidate[] {
  const rows = variants
    .map((v) => ({ ...v, rank: sizeRank(v.sizeLabel), canon: barcodeKey(v.barcode) }))
    .filter((v) => v.rank !== null)
    .sort((a, b) => (a.rank as number) - (b.rank as number));

  if (rows.length < 3) return []; // too short to establish a pattern
  const known = rows.filter((r) => r.canon);
  if (known.length < 2) return [];

  // One prefix, or these are not one allocation.
  const prefix = known[0].canon!.slice(0, 7);
  if (!known.every((k) => k.canon!.startsWith(prefix))) return [];

  const core = (b: string) => Number(b.slice(0, 12));
  // Strictly increasing with size, or the run was not allocated in order.
  for (let i = 1; i < known.length; i++) {
    if (core(known[i].canon!) <= core(known[i - 1].canon!)) return [];
  }

  const out: BarcodeCandidate[] = [];
  const basis = rows.map((r) => ({ variantSku: r.variantSku, barcode: r.canon }));

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].canon) continue;

    // Nearest barcoded neighbour on each side.
    let lo = i - 1;
    while (lo >= 0 && !rows[lo].canon) lo--;
    let hi = i + 1;
    while (hi < rows.length && !rows[hi].canon) hi++;
    if (lo < 0 || hi >= rows.length) continue; // only interpolate, never extrapolate

    const span = core(rows[hi].canon!) - core(rows[lo].canon!);
    const missing = hi - lo - 1;
    // The numbers between the neighbours must match the sizes between them
    // exactly, or which number belongs to which size is unknown.
    if (span !== missing + 1) continue;

    const proposed = ean(String(core(rows[lo].canon!) + (i - lo)).padStart(12, "0"));
    out.push({
      variantId: rows[i].id,
      variantSku: rows[i].variantSku,
      colorwaySku,
      proposed,
      confidence: missing === 1 ? "forced" : "likely",
      reason:
        missing === 1
          ? `one size missing between ${rows[lo].variantSku} and ${rows[hi].variantSku}, and exactly one number fits`
          : `${missing} sizes missing across ${span - 1} free numbers — the run is sequential, so they map in order`,
      basis,
    });
  }
  return out;
}

export interface InferenceReport {
  candidates: BarcodeCandidate[];
  outOfSequence: OutOfSequence[];
  scannedColorways: number;
  variantsWithoutBarcode: number;
}

/** Scan the catalogue for inferable barcodes. Read-only. */
export async function inferMissingBarcodes(limit = 500): Promise<InferenceReport> {
  // Only colourways that have at least one gap and at least two known codes.
  const colorways = await prisma.colorway.findMany({
    where: { kind: "MERCHANDISE", archived: false },
    select: {
      colorwaySku: true,
      variants: { select: { id: true, variantSku: true, sizeLabel: true, barcode: true } },
    },
  });

  const candidates: BarcodeCandidate[] = [];
  const odd: OutOfSequence[] = [];
  let gaps = 0;
  for (const c of colorways) {
    gaps += c.variants.filter((v) => !v.barcode).length;
    if (candidates.length < limit) candidates.push(...inferForRun(c.colorwaySku, c.variants));
    if (odd.length < limit) odd.push(...outOfSequenceForRun(c.colorwaySku, c.variants));
  }
  candidates.sort(
    (a, b) =>
      (a.confidence === b.confidence ? 0 : a.confidence === "forced" ? -1 : 1) ||
      a.variantSku.localeCompare(b.variantSku)
  );
  return {
    candidates: candidates.slice(0, limit),
    outOfSequence: odd.slice(0, limit),
    scannedColorways: colorways.length,
    variantsWithoutBarcode: gaps,
  };
}
