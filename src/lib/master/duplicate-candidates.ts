// Finding the same garment held twice in the master under different SKUs.
//
// This is the case neither of the other two mechanisms reaches. A merge handles
// two records once you know they are the same; an alias handles one record that
// two systems name differently. Neither *finds* anything. And barcode cannot
// find these, because the whole problem is that one side has no barcode.
//
// The shape is consistent and it follows from how the master was populated: the
// Cin7 import brought a garment in under the modern SKU with its barcodes, and
// the Threadflow sync brought the same garment in under the retired LIV-M-/LIV-W-
// gender-prefixed SKU with none. Both records are live, same style, same name,
// same size run.
//
//   Initial / Celeste Ox   LIV-INTL-CLST-OX    CIN7_IMPORT   6 variants, 6 barcoded
//                          LIV-M-NTL-CLST-X    THREADFLOW    6 variants, 0 barcoded
//
// Matching is on style + colourway name + colour, never on the SKU. SKU
// similarity was measured and rejected (see sku.ts); the names are what survived
// the rename.

import { prisma } from "@/lib/db";

/**
 * Vintage is one-of-one, and that makes name matching actively wrong for it.
 *
 * Six second-hand Tommy Hilfiger shirts in XL are six garments with six SKUs and
 * one name. They account for 138 of the 166 raw name collisions — the large
 * majority — and merging any of them would delete real stock. Excluded by
 * default, and the exclusion is the reason this is a report rather than a job.
 */
const ONE_OF_ONE = /^(VN-|EXT-VN-)/;

export type DupConfidence = "high" | "medium";

export interface DupMember {
  colorwayId: string;
  colorwaySku: string;
  source: string;
  variants: number;
  barcoded: number;
}

export interface DupCandidate {
  styleName: string;
  name: string;
  color: string | null;
  confidence: DupConfidence;
  reason: string;
  /** The record to keep — the one carrying barcodes, where that is decisive. */
  keep: DupMember;
  absorb: DupMember[];
}

export interface DupReport {
  candidates: DupCandidate[];
  /** Name collisions skipped because the SKUs are one-of-one vintage. */
  vintageSkipped: number;
  scanned: number;
}

const key = (s: string | null | undefined) =>
  String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function findDuplicateCandidates(): Promise<DupReport> {
  const rows = await prisma.colorway.findMany({
    where: {
      kind: "MERCHANDISE",
      archived: false,
      NOT: { colorwaySku: { contains: "--merged-into-" } },
    },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      color: true,
      source: true,
      style: { select: { styleName: true } },
      variants: { select: { barcode: true } },
    },
  });

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${key(r.style.styleName)}|${key(r.name)}|${key(r.color)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const candidates: DupCandidate[] = [];
  let vintageSkipped = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map((g) => g.colorwaySku)).size < 2) continue;

    if (group.every((g) => ONE_OF_ONE.test(g.colorwaySku))) {
      vintageSkipped++;
      continue;
    }

    const members: DupMember[] = group.map((g) => ({
      colorwayId: g.id,
      colorwaySku: g.colorwaySku,
      source: g.source,
      variants: g.variants.length,
      barcoded: g.variants.filter((v) => v.barcode).length,
    }));

    // High confidence needs the size runs to agree and the barcode coverage to
    // be complementary — one side has them all, the other none. That is the
    // import-versus-sync signature, and it also says which record to keep.
    const sameRun =
      members.length === 2 &&
      members[0].variants === members[1].variants &&
      members[0].variants > 0;
    const complementary =
      sameRun &&
      ((members[0].barcoded > 0 && members[1].barcoded === 0) ||
        (members[1].barcoded > 0 && members[0].barcoded === 0));

    const sorted = [...members].sort((a, b) => b.barcoded - a.barcoded || b.variants - a.variants);

    candidates.push({
      styleName: group[0].style.styleName,
      name: group[0].name,
      color: group[0].color,
      confidence: complementary ? "high" : "medium",
      reason: complementary
        ? `same ${members[0].variants}-size run; ${sorted[0].colorwaySku} carries every barcode and ${sorted[1].colorwaySku} none`
        : "same style, name and colour under different SKUs",
      keep: sorted[0],
      absorb: sorted.slice(1),
    });
  }

  candidates.sort(
    (a, b) =>
      (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1) ||
      a.styleName.localeCompare(b.styleName)
  );
  return { candidates, vintageSkipped, scanned: rows.length };
}
