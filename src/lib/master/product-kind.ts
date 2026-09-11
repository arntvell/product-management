// Classifying what a record *is*.
//
// These rules were developed in scripts/reconcile/reconcile.py, where they
// existed as constants because the master had no way to express them. Every one
// earned its place by catching a wrong conclusion:
//
//   - Cin7 is also the production system. Counting its buttons and fabric as
//     merchandise put one SKU at 95,598 units and made every stock figure
//     meaningless.
//   - A handful of aggregate rows hold enormous quantities — one sale bucket
//     carries 2,040 units — so they dominate any list sorted by quantity and
//     would be the first thing imported by anyone working top-down.
//   - "Webshipper test jeans" hold 496 units across four sizes in live systems.
//
// Now they live in the model, so every consumer of the master gets the same
// answer instead of each one re-deriving it.

import type { ProductKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordDecisions } from "./provenance";

export interface KindRule {
  kind: ProductKind;
  pattern: RegExp;
  label: string;
}

/**
 * Matched in order against SKU + product name, first hit wins.
 *
 * Order matters in one place: the imperfect *bucket* (LIV-IMP-TIA-OS, an
 * aggregate standing for many garments) must be caught before anything keys off
 * the IMP- prefix, because individual imperfects — IMP-LIV-FLY-…-3634 — are real
 * merchandise sold at a discount and must stay that way.
 */
export const KIND_RULES: KindRule[] = [
  { kind: "TEST", pattern: /WBTST|WEBSHIPPER|-TEST-|^TEST/, label: "test data" },
  { kind: "AGGREGATE", pattern: /SLGSV/, label: "sale bucket" },
  { kind: "AGGREGATE", pattern: /^EXT-VN-NW-|^EXT-VN-[A-Z]+$/, label: "vintage bulk lot" },
  // Anchored deliberately: this matches the *bucket* forms LIV-IMP-TIA-OS and
  // EXT-IMP-MISC — one SKU standing for many garments — and must never match the
  // IMP- prefix forms like IMP-LIV-BRNS-JPN-DWN, which are individual imperfect
  // garments sold at a discount and are real merchandise. 76 of those exist.
  { kind: "AGGREGATE", pattern: /^(LIV|EXT)-IMP-[A-Z]+(-OS)?$/, label: "imperfect bucket" },
  { kind: "SAMPLE", pattern: /SMPL|^S-\d+$|SAMPLE/, label: "sample" },
  { kind: "CONSUMABLE", pattern: /^STORAGE-/, label: "internal storage" },
  { kind: "SERVICE", pattern: /PICKUP|PCKUP|REPS|REPARASJON/, label: "repair or pickup" },
  { kind: "SERVICE", pattern: /GFTCRD|GIFT/, label: "gift card" },
];

/** Cin7 categories that are production inputs or services, not merchandise. */
export const NON_MERCH_CATEGORIES: Record<string, ProductKind> = {
  Button: "MATERIAL",
  Fabric: "MATERIAL",
  wrapin: "MATERIAL",
  Stork: "MATERIAL",
  Sample: "SAMPLE",
  "SAMPLE PACK": "SAMPLE",
  Service: "SERVICE",
  Skredder: "SERVICE", // tailoring
  "Gift Cards": "SERVICE",
  Storage: "CONSUMABLE",
  lager: "CONSUMABLE", // warehouse
  "Non-inventory": "CONSUMABLE",
  Fitguide: "CONSUMABLE",
  Shopify: "CONSUMABLE",
  SAVED: "CONSUMABLE",
};

export interface ClassifyInput {
  sku: string;
  name?: string | null;
  productType?: string | null;
}

export interface Classification {
  kind: ProductKind;
  reason: string | null;
}

export function classifyKind(input: ClassifyInput): Classification {
  // Tested against the SKU and the name SEPARATELY, never concatenated.
  //
  // Concatenating breaks every anchored rule: `^LIV-IMP-[A-Z]+-OS$` cannot match
  // "LIV-IMP-TIA-OS IMPERFECT TIA, OS" because `$` is no longer at the end. The
  // original rules in reconcile.py had exactly this defect, so the
  // imperfect-bucket rule never fired there either.
  const sku = input.sku.toUpperCase();
  const name = (input.name ?? "").toUpperCase();
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(sku) || rule.pattern.test(name)) {
      return { kind: rule.kind, reason: rule.label };
    }
  }
  const byCategory = input.productType ? NON_MERCH_CATEGORIES[input.productType] : undefined;
  if (byCategory) {
    return { kind: byCategory, reason: `category "${input.productType}"` };
  }
  return { kind: "MERCHANDISE", reason: null };
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------


export interface KindBackfillResult {
  scanned: number;
  /** Rows a rule actively decided — attribution written for each. */
  attributed: number;
  changed: number;
  byKind: Array<{ kind: ProductKind; count: number; reason: string | null }>;
  examples: Array<{ colorwaySku: string; name: string; from: ProductKind; to: ProductKind; reason: string }>;
  dryRun: boolean;
}

/**
 * Set `kind` on every colorway from its SKU, name and product type.
 *
 * Safe to re-run: it only writes rows whose classification differs from what is
 * stored, and it attributes each write so a later reviewer can see the rule that
 * produced it rather than guessing.
 */
export async function backfillProductKind(
  opts: { dryRun?: boolean } = {}
): Promise<KindBackfillResult> {
  const colorways = await prisma.colorway.findMany({
    select: { id: true, colorwaySku: true, name: true, productType: true, kind: true },
  });

  const counts = new Map<string, { kind: ProductKind; count: number; reason: string | null }>();
  const examples: KindBackfillResult["examples"] = [];
  const updates = new Map<ProductKind, string[]>();
  const decisions: Parameters<typeof recordDecisions>[0] = [];

  for (const cw of colorways) {
    const { kind, reason } = classifyKind({
      sku: cw.colorwaySku,
      name: cw.name,
      productType: cw.productType,
    });
    const key = `${kind}|${reason ?? ""}`;
    const bucket = counts.get(key) ?? { kind, count: 0, reason };
    bucket.count++;
    counts.set(key, bucket);

    // Attribution is recorded for every row a rule actually decided, not only
    // for rows whose value changes. Otherwise a re-run cannot repair missing
    // attributions, and the default MERCHANDISE case would bury 3,198 rows of
    // "no rule matched" noise in a table meant to answer real questions.
    if (reason) {
      decisions.push({
        entityType: "colorway",
        entityId: cw.id,
        field: "kind",
        owner: "MANUAL",
        authority: "origio:classify-kind",
        evidence: reason,
      });
    }

    if (kind === cw.kind) continue;
    (updates.get(kind) ?? updates.set(kind, []).get(kind)!).push(cw.id);
    if (examples.length < 25) {
      examples.push({
        colorwaySku: cw.colorwaySku,
        name: cw.name,
        from: cw.kind,
        to: kind,
        reason: reason ?? "default",
      });
    }
  }

  const changed = [...updates.values()].reduce((a, b) => a + b.length, 0);

  if (!opts.dryRun) {
    for (const [kind, ids] of updates) {
      // Chunked: a single updateMany over thousands of ids builds a query large
      // enough to matter, and the loop keeps each statement bounded.
      for (let i = 0; i < ids.length; i += 500) {
        await prisma.colorway.updateMany({
          where: { id: { in: ids.slice(i, i + 500) } },
          data: { kind },
        });
      }
    }
    await recordDecisions(decisions);
  }

  return {
    scanned: colorways.length,
    attributed: decisions.length,
    changed,
    byKind: [...counts.values()].sort((a, b) => b.count - a.count),
    examples,
    dryRun: Boolean(opts.dryRun),
  };
}
