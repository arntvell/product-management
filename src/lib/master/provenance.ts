// Recording why a value in the master says what it says.
//
// FieldOwner already carried `owner: Source` — THREADFLOW, MANUAL,
// SHOPIFY_IMPORT, CIN7_IMPORT — which records the *pipeline* a value arrived
// through. That is not the same as the authority that decided it. After the
// 2026-09-11 reconciliation corrected 122 barcodes from the CFO's list, the
// question "why does this barcode say X?" could not be answered from the
// database at all: the answer lived in a CSV and a commit message.
//
// Two things were missing and are now present: an `authority`/`evidence`/
// `decidedAt` triple, and "variant" as an entityType — barcode lives on Variant,
// so it could not previously be attributed even in principle.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma, type Source } from "@/generated/prisma/client";

export type EntityType = "style" | "colorway" | "variant";

export interface Decision {
  entityType: EntityType;
  entityId: string;
  field: string;
  /** The pipeline the value arrived through. */
  owner: Source;
  /**
   * Who decided it, when `owner` is too coarse. Free text by design, so a new
   * authority does not need a migration:
   *   "cfo-list-2026-09-11"  the CFO's barcode ledger
   *   "sitoo"                the POS, where a wrong barcode fails physically
   *   "manual:scan"          somebody scanned the garment
   *   "origio:allocate"      the master issued it
   */
  authority: string;
  /** What backs the decision — a file name, a ticket, a majority count. */
  evidence?: string | null;
  /** Prevent later automated writes from changing it. */
  lock?: boolean;
}

/**
 * Record one decision. Idempotent per (entityType, entityId, field), which is
 * the existing unique key — re-deciding a field replaces the record rather than
 * accumulating history.
 */
export async function recordDecision(d: Decision): Promise<void> {
  await recordDecisions([d]);
}

/**
 * Record many. Used by the reconciliation appliers, where a run corrects
 * hundreds of values and each needs its own attribution.
 */
export async function recordDecisions(decisions: Decision[]): Promise<number> {
  if (!decisions.length) return 0;
  const now = new Date();

  // One multi-row INSERT ... ON CONFLICT DO UPDATE per chunk, not one upsert per
  // row. The per-row form was 200 round trips inside a single $transaction and
  // overran the 5 s transaction budget at 206 decisions — it wrote the values
  // and then lost every attribution, which is the one failure this module exists
  // to prevent.
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < decisions.length; i += CHUNK) {
    const chunk = decisions.slice(i, i + CHUNK);
    const values = chunk.map(
      (d) => Prisma.sql`(
        ${randomUUID()}, ${d.entityType}, ${d.entityId}, ${d.field},
        ${d.owner}::"Source", ${d.authority}, ${d.evidence ?? null},
        ${now}, ${d.lock ? now : null}
      )`
    );
    written += await prisma.$executeRaw`
      INSERT INTO "FieldOwner"
        ("id", "entityType", "entityId", "field", "owner", "authority", "evidence", "decidedAt", "lockedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("entityType", "entityId", "field") DO UPDATE SET
        "owner"     = EXCLUDED."owner",
        "authority" = EXCLUDED."authority",
        "evidence"  = EXCLUDED."evidence",
        "decidedAt" = EXCLUDED."decidedAt",
        "lockedAt"  = COALESCE(EXCLUDED."lockedAt", "FieldOwner"."lockedAt")
    `;
  }
  return written;
}

export interface Attribution {
  field: string;
  owner: Source;
  authority: string | null;
  evidence: string | null;
  decidedAt: Date | null;
  locked: boolean;
}

/** Answer "why does this say X?" for one record. */
export async function explain(
  entityType: EntityType,
  entityId: string
): Promise<Attribution[]> {
  const rows = await prisma.fieldOwner.findMany({
    where: { entityType, entityId },
    orderBy: { field: "asc" },
  });
  return rows.map((r) => ({
    field: r.field,
    owner: r.owner,
    authority: r.authority,
    evidence: r.evidence,
    decidedAt: r.decidedAt,
    locked: r.lockedAt !== null,
  }));
}

/** Fields a human or a named authority has settled, which automation must not overwrite. */
export async function lockedFields(
  entityType: EntityType,
  entityIds: string[]
): Promise<Map<string, Set<string>>> {
  if (!entityIds.length) return new Map();
  const rows = await prisma.fieldOwner.findMany({
    where: { entityType, entityId: { in: entityIds }, NOT: { lockedAt: null } },
    select: { entityId: true, field: true },
  });
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    (out.get(r.entityId) ?? out.set(r.entityId, new Set()).get(r.entityId)!).add(r.field);
  }
  return out;
}
