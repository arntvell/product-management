// Colourways Loom already held under the correct parent, from the September 2026
// Cin7 re-grouping.
//
// What remains of a one-off migration pass. The pass itself — planRegroup and
// applyRegroup, driven by hand-curated NEW_STYLE_GROUPS and PARENT_OVERRIDE
// tables — has been superseded by master/style-splits.ts, which finds the same
// shapes by rule instead of by list, reports confidence, and records the
// judgement calls in StyleNameRule so a review screen can add to them.
//
// This list stays because threadflow/sync.ts imports it: these SKUs are Cin7
// rows whose colour already exists under the right parent from Threadflow, so
// re-pointing them would give that parent two copies of one colour.

/** Colorways Loom already holds under the correct parent — withdraw ours. */
export const DUPLICATE_SKUS = [
  "LIV-ABY-WH", "LIV-COT-WHT", "LIV-V-WHT", "LIV-ID-BLCK",
  "LIV-INTL-CLST-OX", "LIV-INTL-CLST-PNSTRP-OX", "LIV-INTL-GRY-OX", "LIV-INTL-WHT-OX",
  "LIV-K-JPN-BLCK", "LIV-KRI-JPN-SNDBX", "LIV-KR-JPN-DWN", "LIV-ML-WHT",
  "LIV-NAR-WHT", "LIV-Needle-W", "LIV-SRN-JPN-BLCK-DSK", "LIV-T-JPN-BLCK",
  "LIV-T-JPN-NW-BL",
] as const;
