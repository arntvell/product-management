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
  normalizeDraftStep,
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
  /** The first draft's id when this draft is one style of several; else null. */
  groupId: string | null;
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
  /** Styles in this build: 1, or the size of its group. */
  styles: number;
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
  return toView(d);
}

function toView(d: {
  id: string;
  title: string;
  status: string;
  step: string;
  revision: number;
  payload: unknown;
  finalizeError: string | null;
  createdStyleIds: string[];
  createdColorwayIds: string[];
  groupId: string | null;
  updatedAt: Date;
}): DraftView {
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    step: normalizeDraftStep(d.step),
    revision: d.revision,
    payload: parseDraftPayload(d.payload),
    finalizeError: d.finalizeError,
    createdStyleIds: d.createdStyleIds,
    createdColorwayIds: d.createdColorwayIds,
    groupId: d.groupId,
    updatedAt: d.updatedAt.toISOString(),
  };
}

/**
 * The other styles built alongside `leadId`, oldest first. Discarded ones are
 * gone; created ones stay, so the review and the done page can say so.
 */
export async function getGroupSiblings(leadId: string): Promise<DraftView[]> {
  const rows = await prisma.productDraft.findMany({
    where: { groupId: leadId, id: { not: leadId }, status: { not: "DISCARDED" } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toView);
}

/**
 * Another style in the same build.
 *
 * Its own draft, not a second style inside this one's payload: finalize, the
 * reserved ids and the resume probe are all per draft, and a group of drafts
 * gets them for nothing. Brand, season, channels and kind are the lead's,
 * because they are chosen once for the whole build; the template is the
 * caller's, normally the brand's defaults, never the lead's filled-in customs,
 * which belong to a different garment.
 */
export async function addStyleToDraft(leadId: string, template: unknown): Promise<DraftView> {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.productDraft.findUnique({ where: { id: leadId } });
    if (!lead) throw new DraftNotFoundError("Draft not found.");
    if (lead.status !== "DRAFT")
      throw new DraftConflictError(
        `This draft is ${lead.status.toLowerCase()} and can no longer take another style.`,
        { revision: lead.revision, status: lead.status }
      );
    if (lead.groupId && lead.groupId !== lead.id)
      throw new DraftConflictError("Add styles from the first style of the build.", {
        revision: lead.revision,
        status: lead.status,
      });

    const from = parseDraftPayload(lead.payload);
    const payload = parseDraftPayload({
      ...emptyDraftPayload(),
      brand: from.brand,
      seasonId: from.seasonId,
      channels: from.channels,
      kind: from.kind,
      template,
    });

    // Not a payload change, so not a revision bump: the lead's open tab keeps
    // saving without a conflict.
    if (!lead.groupId)
      await tx.productDraft.update({ where: { id: leadId }, data: { groupId: leadId } });

    const created = await tx.productDraft.create({
      data: {
        title: draftTitle(payload),
        payload: payload as unknown as object,
        schemaVersion: DRAFT_SCHEMA_VERSION,
        step: "build",
        brandId: payload.brand.id,
        seasonId: payload.seasonId,
        channels: payload.channels,
        groupId: leadId,
      },
    });
    return toView(created);
  });
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
      groupId: true,
      updatedAt: true,
      brand: { select: { name: true } },
      season: { select: { code: true } },
    },
  });

  // One row per build. A style added to another draft is listed under that
  // draft, not as a second thing to open; its counts are added to the lead's.
  type Extra = { colorways: number; variants: number; styles: number; interrupted: boolean };
  const siblings = new Map<string, Extra>();
  const leadIds = new Set(rows.filter((r) => !r.groupId || r.groupId === r.id).map((r) => r.id));

  const summaries = rows.map((r) => {
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
      step: normalizeDraftStep(r.step),
      brandName: r.brand?.name ?? null,
      seasonCode: r.season?.code ?? null,
      colorways,
      variants,
      styles: 1,
      finalizeError: r.finalizeError,
      updatedAt: r.updatedAt.toISOString(),
      groupId: r.groupId,
    };
  });

  for (const s of summaries) {
    if (!s.groupId || s.groupId === s.id || !leadIds.has(s.groupId)) continue;
    const t = siblings.get(s.groupId) ?? { colorways: 0, variants: 0, styles: 0, interrupted: false };
    t.interrupted ||= s.status === "FINALIZING";
    t.colorways += s.colorways;
    t.variants += s.variants;
    t.styles += 1;
    siblings.set(s.groupId, t);
  }

  return summaries
    // A sibling whose lead is not listed (finished, or discarded on its own)
    // stays visible, so nothing in progress disappears from the list.
    .filter((s) => !(s.groupId && s.groupId !== s.id && leadIds.has(s.groupId)))
    .map(({ groupId, ...s }) => {
      const t = groupId === s.id ? siblings.get(s.id) : undefined;
      return t
        ? {
            ...s,
            colorways: s.colorways + t.colorways,
            variants: s.variants + t.variants,
            styles: 1 + t.styles,
            // An interrupted style is the one state that needs acting on, so
            // it must not hide behind a lead that is merely in progress.
            status: t.interrupted ? "FINALIZING" : s.status,
          }
        : s;
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
      ...(input.step ? { step: normalizeDraftStep(input.step) } : {}),
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
 * Abandon a draft, and with the first style of a build, the rest of it.
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
  // Only the lead carries its own id as groupId, so for any other draft this
  // matches nothing. Created siblings are left alone: they are in the master.
  await prisma.productDraft.updateMany({
    where: { groupId: id, id: { not: id }, status: { in: ["DRAFT", "FINALIZING"] } },
    data: { status: "DISCARDED" },
  });
}

export { DraftPayloadError };
export type { DraftPayloadV1, PublishChannelKey };
