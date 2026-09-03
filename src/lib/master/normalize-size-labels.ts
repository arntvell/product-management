// Normalize two-dimensional variant sizes so every source agrees.
//
// Threadflow sends the length already prefixed ("L32"); Cin7 sends it bare
// ("32"). The Threadflow ingestion used to prepend its own "L" on top, so those
// rows carry `sizeLabel: "W27/LL32"` and `dim2: "L32"` while Cin7 rows carry
// "W27/L32" and "32". `deriveSize` no longer does that, and this pass brings the
// rows already in the master into line.
//
// Only 2-D sizes are touched. A one-dimensional size is a letter, and stripping
// a prefix from "L" (Large) would leave nothing.
//
// Re-runnable and idempotent: a row already in canonical form is not listed.
import { prisma } from "@/lib/db";

export interface SizeLabelChange {
  variantId: string;
  variantSku: string;
  from: { sizeLabel: string; dim1: string; dim2: string };
  to: { sizeLabel: string; dim1: string; dim2: string };
}

export interface SizeLabelPreview {
  scanned: number;
  changes: SizeLabelChange[];
  /** How many rows were already canonical. */
  unchanged: number;
}

export interface SizeLabelResult extends SizeLabelPreview {
  updated: number;
}

function canonical(dim1: string, dim2: string) {
  const waist = dim1.trim().replace(/^W+/i, "");
  const length = dim2.trim().replace(/^L+/i, "");
  return { sizeLabel: `W${waist}/L${length}`, dim1: waist, dim2: length };
}

export async function previewSizeLabelNormalisation(): Promise<SizeLabelPreview> {
  const rows = await prisma.variant.findMany({
    where: { dim2: { not: null } },
    select: { id: true, variantSku: true, sizeLabel: true, dim1: true, dim2: true },
  });

  const changes: SizeLabelChange[] = [];
  for (const v of rows) {
    const from = { sizeLabel: v.sizeLabel, dim1: v.dim1, dim2: v.dim2! };
    const to = canonical(v.dim1, v.dim2!);
    if (
      to.sizeLabel === from.sizeLabel &&
      to.dim1 === from.dim1 &&
      to.dim2 === from.dim2
    )
      continue;
    changes.push({ variantId: v.id, variantSku: v.variantSku, from, to });
  }

  return { scanned: rows.length, changes, unchanged: rows.length - changes.length };
}

/** The canonical form, expressed in SQL so the whole set moves in one write. */
const CANON_DIM1 = `regexp_replace("dim1", '^W+', '', 'i')`;
const CANON_DIM2 = `regexp_replace("dim2", '^L+', '', 'i')`;
const CANON_LABEL = `'W' || ${CANON_DIM1} || '/L' || ${CANON_DIM2}`;

export async function runSizeLabelNormalisation(): Promise<SizeLabelResult> {
  const plan = await previewSizeLabelNormalisation();
  if (!plan.changes.length) return { ...plan, updated: 0 };

  // One statement rather than 2,500 round-trips. Every value is derived from the
  // row's own columns, so `updateMany` cannot express it — and `updatedAt` is
  // Prisma-managed, so raw SQL has to set it.
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "Variant"
        SET "dim1" = ${CANON_DIM1},
            "dim2" = ${CANON_DIM2},
            "sizeLabel" = ${CANON_LABEL},
            "updatedAt" = now()
      WHERE "dim2" IS NOT NULL
        AND ("dim1" ~* '^W' OR "dim2" ~* '^L' OR "sizeLabel" <> ${CANON_LABEL})`
  );

  return { ...plan, updated };
}
