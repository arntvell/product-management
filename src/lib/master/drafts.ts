// Draft CRUD, and the compare-and-swap that makes autosave safe.
//
// The wizard saves the whole payload on an idle timer, the way catalog-grid.tsx
// does. That grid retires "only the keys sent, and only if unchanged", which
// needs a key map; a whole-document draft has none, so the equivalent guarantee
// comes from a revision counter. A PUT carries the revision it read, the UPDATE
// matches on it, and a count of zero means somebody else moved first — a second
// tab, or a finalize that has already claimed the draft. Either way the right
// answer is to tell the user, not to overwrite.

import { prisma } from "@/lib/db";
import {
  parseDraftPayload,
  emptyDraftPayload,
  draftTitle,
  DraftPayloadError,
  DRAFT_SCHEMA_VERSION,
  type DraftPayloadV1,
  type DraftStep,
} from "./draft-payload";
import type { PublishChannelKey } from "./fields";

export class DraftConflictError extends Error {
  constructor(
    message: string,
    readonly current: { revision: number; status: string }
  ) {
    super(message);
  }
}
export class DraftNotFoundError extends Error {}

export interface DraftView {
  id: string;
  title: string;
  status: string;
  step: DraftStep;
  revision: number;
  payload: DraftPayloadV1;
  finalizeError: string | null;
  createdStyleIds: string[];
  createdColorwayIds: string[];
  updatedAt: string;
}

export interface DraftSummary {
  id: string;
  title: string;
  status: string;
  step: string;
  brandName: string | null;
  seasonCode: string | null;
  colorways: number;
  variants: number;
  finalizeError: string | null;
  updatedAt: string;
}

export async function createDraft(): Promise<string> {
  const payload = emptyDraftPayload();
  const draft = await prisma.productDraft.create({
    data: {
      title: draftTitle(payload),
      payload: payload as unknown as object,
      schemaVersion: DRAFT_SCHEMA_VERSION,
    },
    select: { id: true },
  });
  return draft.id;
}

export async function getDraft(id: string): Promise<DraftView> {
  const d = await prisma.productDraft.findUnique({ where: { id } });
  if (!d) throw new DraftNotFoundError("Draft not found.");
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    step: d.step as DraftStep,
    revision: d.revision,
    payload: parseDraftPayload(d.payload),
    finalizeError: d.finalizeError,
    createdStyleIds: d.createdStyleIds,
    createdColorwayIds: d.createdColorwayIds,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function listDrafts(
  opts: { includeFinished?: boolean } = {}
): Promise<DraftSummary[]> {
  const rows = await prisma.productDraft.findMany({
    where: opts.includeFinished
      ? {}
      : { status: { in: ["DRAFT", "FINALIZING"] } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      step: true,
      payload: true,
      finalizeError: true,
      updatedAt: true,
      brand: { select: { name: true } },
      season: { select: { code: true } },
    },
  });

  return rows.map((r) => {
    let colorways = 0;
    let variants = 0;
    try {
      const p = parseDraftPayload(r.payload);
      colorways = p.colorways.length;
      variants = p.colorways.reduce((a, c) => a + c.variants.length, 0);
    } catch {
      // A payload we cannot read is still a row worth listing — that is exactly
      // when someone needs to see it.
    }
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      step: r.step,
      brandName: r.brand?.name ?? null,
      seasonCode: r.season?.code ?? null,
      colorways,
      variants,
      finalizeError: r.finalizeError,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export interface SaveDraftInput {
  revision: number;
  payload: unknown;
  step?: DraftStep;
}

/**
 * Autosave. Returns the new revision, or throws DraftConflictError.
 *
 * `status: "DRAFT"` is part of the WHERE on purpose: once finalize has claimed a
 * draft, an in-flight autosave from the same tab must not be able to change the
 * payload underneath it.
 */
export async function saveDraft(
  id: string,
  input: SaveDraftInput
): Promise<{ revision: number; title: string }> {
  const payload = parseDraftPayload(input.payload);
  const title = draftTitle(payload);

  const res = await prisma.productDraft.updateMany({
    where: { id, revision: input.revision, status: "DRAFT" },
    data: {
      payload: payload as unknown as object,
      title,
      ...(input.step ? { step: input.step } : {}),
      brandId: payload.brand.id,
      seasonId: payload.seasonId,
      channels: payload.channels,
      revision: { increment: 1 },
    },
  });

  if (res.count === 1) return { revision: input.revision + 1, title };

  const current = await prisma.productDraft.findUnique({
    where: { id },
    select: { revision: true, status: true },
  });
  if (!current) throw new DraftNotFoundError("Draft not found.");
  if (current.status !== "DRAFT")
    throw new DraftConflictError(
      `This draft is ${current.status.toLowerCase()} and can no longer be edited.`,
      current
    );
  throw new DraftConflictError(
    "Someone else saved this draft in another tab. Reload to see their version.",
    current
  );
}

/**
 * Abandon a draft.
 *
 * DISCARDED, never deleted. A barcode allocated while drafting is in the ledger
 * for good — allocation is a one-way door — so the row that explains which SKU
 * it was issued for has to outlive the attempt.
 */
export async function discardDraft(id: string): Promise<void> {
  const res = await prisma.productDraft.updateMany({
    where: { id, status: { in: ["DRAFT", "FINALIZING"] } },
    data: { status: "DISCARDED" },
  });
  if (res.count === 0) {
    const d = await prisma.productDraft.findUnique({ where: { id }, select: { status: true } });
    if (!d) throw new DraftNotFoundError("Draft not found.");
    throw new DraftConflictError(`A ${d.status.toLowerCase()} draft cannot be discarded.`, {
      revision: 0,
      status: d.status,
    });
  }
}

export { DraftPayloadError };
export type { DraftPayloadV1, PublishChannelKey };
