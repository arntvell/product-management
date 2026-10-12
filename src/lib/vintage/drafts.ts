// Vintage drops in progress, saved in Origo.
//
// A drop used to live in one browser's localStorage until Create, so it could
// not be picked up on another machine, and only one could be in hand. Drafts
// fix both. What makes them more than a saved form is the numbering.
//
// THE NUMBERING RULE. Item numbers are not chosen; each one fixes a SKU, a
// handle and a pre-assigned barcode (vintage-numbering.ts). With several drops
// drafted at once, the drafts are PACKED: in order, from one anchor, each row
// taking the next number the master has not used. So:
//
//   - a new draft starts after everything — the master, Shopify, and every
//     other draft;
//   - growing or shrinking a draft renumbers the drafts after it, so every
//     drop stays one continuous run (the vintage team's choice, 2026-10-12:
//     labels are printed late, a broken run is the bigger nuisance);
//   - deleting a draft closes its gap the same way;
//   - a created garment leaves its draft for the master, and its number is
//     then simply in use — the pack steps over it.
//
// A row whose number moves loses its matched photographs (the share names
// files by number, so they would now be someone else's), and the draft gets a
// notice saying what moved, until someone has seen it.
//
// Every change to the chain runs under one advisory lock, so two people
// resizing two drafts at once cannot hand out the same number twice.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  barcodeForItemNumber,
  isPreassigned,
  itemHandle,
  itemSku,
  itemVariantSku,
  LAST_PREASSIGNED_ITEM,
} from "@/lib/master/vintage-numbering";
import { highestVintageItemNumber } from "@/lib/shopify/vintage-highest";

export class DraftError extends Error {
  constructor(
    message: string,
    readonly status = 422
  ) {
    super(message);
  }
}

export interface DraftPhoto {
  url: string;
  index: number;
  filename: string;
}

/** What a person writes about one garment. */
export interface DraftRowContent {
  include: boolean;
  photos: DraftPhoto[];
  title: string;
  description: string;
  category: string;
  sourceProduct: string;
  originalBrand: string;
  taggedSize: string;
  approxSize: string;
  chestWidth: string;
  frontLength: string;
  waist: string;
  frontRise: string;
  inseam: string;
  composition: string;
  price: string;
  cost: string;
  tags: string;
}

/** A stored row: the content, its stable id, and the number it holds now. */
export interface DraftRow extends DraftRowContent {
  rowId: string;
  itemNumber: number;
}

/** A row as the sheet sees it — with everything the number fixes. */
export interface DraftRowView extends Omit<DraftRow, "itemNumber"> {
  itemNumber: string;
  sku: string;
  variantSku: string;
  handle: string;
  barcode: string;
  preassigned: boolean;
}

export interface DraftView {
  id: string;
  drop: string;
  revision: number;
  notice: string | null;
  rows: DraftRowView[];
  updatedAt: string;
}

export interface DraftSummary {
  id: string;
  drop: string;
  count: number;
  first: number | null;
  last: number | null;
  notice: string | null;
  updatedAt: string;
}

const CONTENT_KEYS: (keyof DraftRowContent)[] = [
  "include",
  "photos",
  "title",
  "description",
  "category",
  "sourceProduct",
  "originalBrand",
  "taggedSize",
  "approxSize",
  "chestWidth",
  "frontLength",
  "waist",
  "frontRise",
  "inseam",
  "composition",
  "price",
  "cost",
  "tags",
];

const LOCK = "select pg_advisory_xact_lock(7240012)";

export function dropTag(drop: string): string {
  return `DROP${drop.replace(/\D/g, "")}`;
}

function emptyRow(drop: string, itemNumber: number): DraftRow {
  return {
    rowId: crypto.randomUUID(),
    itemNumber,
    include: true,
    photos: [],
    title: "",
    description: "",
    category: "",
    sourceProduct: "",
    originalBrand: "",
    taggedSize: "",
    approxSize: "",
    chestWidth: "",
    frontLength: "",
    waist: "",
    frontRise: "",
    inseam: "",
    composition: "",
    price: "",
    cost: "",
    tags: `${dropTag(drop)}, rocket-hide, hide`,
  };
}

/** Coerce whatever is stored (or sent) into a row, filling gaps. */
function toRow(raw: unknown, drop: string): DraftRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = emptyRow(drop, Number(r.itemNumber) || 0);
  const out: DraftRow = { ...base, rowId: typeof r.rowId === "string" ? r.rowId : base.rowId };
  for (const k of CONTENT_KEYS) {
    if (r[k] === undefined) continue;
    if (k === "include") out.include = r.include !== false;
    else if (k === "photos") out.photos = Array.isArray(r.photos) ? (r.photos as DraftPhoto[]) : [];
    else (out as unknown as Record<string, unknown>)[k] = String(r[k] ?? "");
  }
  return out;
}

function rowsOf(d: { rows: unknown; drop: string }): DraftRow[] {
  return Array.isArray(d.rows) ? d.rows.map((r) => toRow(r, d.drop)) : [];
}

function view(d: {
  id: string;
  drop: string;
  revision: number;
  notice: string | null;
  rows: unknown;
  updatedAt: Date;
}): DraftView {
  return {
    id: d.id,
    drop: d.drop,
    revision: d.revision,
    notice: d.notice,
    updatedAt: d.updatedAt.toISOString(),
    rows: rowsOf(d).map((r) => ({
      ...r,
      itemNumber: String(r.itemNumber),
      sku: itemSku(r.itemNumber),
      variantSku: itemVariantSku(r.itemNumber),
      handle: itemHandle(r.itemNumber),
      barcode: barcodeForItemNumber(r.itemNumber),
      preassigned: isPreassigned(r.itemNumber),
    })),
  };
}

const range = (rows: DraftRow[]) =>
  rows.length ? `${rows[0].itemNumber}–${rows[rows.length - 1].itemNumber}` : "none";

/** Item numbers the master already holds, at or above `from`. */
async function usedInMaster(tx: Prisma.TransactionClient, from: number): Promise<Set<number>> {
  const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
    `select (regexp_match("colorwaySku", '^VN-ONLN-(\\d+)$'))[1]::int as n
       from "Colorway" where "colorwaySku" ~ '^VN-ONLN-\\d+$'
        and (regexp_match("colorwaySku", '^VN-ONLN-(\\d+)$'))[1]::int >= $1`,
    from
  );
  return new Set(rows.map((r) => r.n));
}

async function highestInMaster(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ max: number | null }[]>(
    `select max((regexp_match("colorwaySku", '^VN-ONLN-(\\d+)$'))[1]::int) as max
       from "Colorway" where "colorwaySku" ~ '^VN-ONLN-\\d+$'`
  );
  return rows[0]?.max ?? 0;
}

/** The lowest number any draft holds — where the pack starts. */
function anchorOf(drafts: { rows: unknown; drop: string }[]): number | null {
  let min: number | null = null;
  for (const d of drafts)
    for (const r of rowsOf(d)) if (r.itemNumber > 0 && (min === null || r.itemNumber < min)) min = r.itemNumber;
  return min;
}

export interface Moved {
  drop: string;
  from: string;
  to: string;
}

/**
 * The packing itself, with no database: drafts in the order they started,
 * rows in their own order, each taking the next number from `anchor` that
 * `blocked` (the master's) does not hold. Returns each draft's rows as they
 * should now be, and whether anything moved. A moved row loses its photos.
 */
export function packNumbers<T extends { rows: DraftRow[] }>(
  drafts: T[],
  anchor: number,
  blocked: Set<number>
): { draft: T; rows: DraftRow[]; changed: boolean }[] {
  const ordered = drafts
    .filter((d) => d.rows.length)
    .sort(
      (a, b) => Math.min(...a.rows.map((r) => r.itemNumber)) - Math.min(...b.rows.map((r) => r.itemNumber))
    );
  let cursor = anchor;
  return ordered.map((d) => {
    let changed = false;
    const rows = d.rows.map((r) => {
      while (blocked.has(cursor)) cursor++;
      const n = cursor++;
      if (n === r.itemNumber) return r;
      changed = true;
      // The share names photos by number: matched to the old one, they are now
      // another garment's.
      return { ...r, itemNumber: n, photos: [] };
    });
    return { draft: d, rows, changed };
  });
}

/**
 * Re-number every draft from `anchor` (packNumbers) and store what moved,
 * with a notice on each moved draft. Returns the drafts that moved.
 */
async function repack(tx: Prisma.TransactionClient, anchor: number | null): Promise<Moved[]> {
  const drafts = await tx.vintageDropDraft.findMany();
  if (anchor === null || !drafts.length) return [];
  const blocked = await usedInMaster(tx, anchor);
  const packed = packNumbers(
    drafts.map((d) => ({ id: d.id, drop: d.drop, rows: rowsOf(d) })),
    anchor,
    blocked
  );
  const moved: Moved[] = [];
  for (const { draft: d, rows, changed } of packed) {
    if (!changed) continue;
    const before = range(d.rows);
    const after = range(rows);
    moved.push({ drop: d.drop, from: before, to: after });
    await tx.vintageDropDraft.update({
      where: { id: d.id },
      data: {
        rows: rows as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
        notice:
          `Item numbers moved from ${before} to ${after}, because a drop before this one changed size. ` +
          `Barcodes moved with them; photos matched before the move were cleared — load them again.`,
      },
    });
  }
  return moved;
}

export async function listDrafts(): Promise<DraftSummary[]> {
  const drafts = await prisma.vintageDropDraft.findMany();
  return drafts
    .map((d) => {
      const rows = rowsOf(d);
      return {
        id: d.id,
        drop: d.drop,
        count: rows.length,
        first: rows[0]?.itemNumber ?? null,
        last: rows[rows.length - 1]?.itemNumber ?? null,
        notice: d.notice,
        updatedAt: d.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity));
}

export async function getDraft(id: string): Promise<DraftView> {
  const d = await prisma.vintageDropDraft.findUnique({ where: { id } });
  if (!d) throw new DraftError("Draft not found.", 404);
  return view(d);
}

/**
 * Start a drop. Numbers follow everything already taken — the master, Shopify
 * (which has garments the master never imported), and every other draft.
 * `content`, when given, fills the rows in order (bringing a browser-only
 * draft across).
 */
export async function createDraft(
  drop: string,
  count: number,
  content: Partial<DraftRowContent>[] = []
): Promise<{ draft: DraftView; beyondPreassigned: number }> {
  const name = drop.trim().replace(/\s+/g, " ");
  if (!name) throw new DraftError("Which drop?");
  if (!Number.isInteger(count) || count < 1 || count > 300) throw new DraftError("Between 1 and 300 garments.");

  // Outside the transaction: a network call has no business holding the lock.
  const onShopify = await highestVintageItemNumber();

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK);
    if (await tx.vintageDropDraft.findUnique({ where: { drop: name } }))
      throw new DraftError(`${name} is already being drafted — open it from the list.`);
    const already = await tx.colorway.count({ where: { entries: { some: { drop: name } } } });
    if (already)
      throw new DraftError(`${name} already has ${already} garment(s) in Origo. Use another drop name, or load it.`);

    const drafts = await tx.vintageDropDraft.findMany();
    let highestDraft = 0;
    for (const d of drafts) for (const r of rowsOf(d)) highestDraft = Math.max(highestDraft, r.itemNumber);
    const start = Math.max(await highestInMaster(tx), onShopify, highestDraft) + 1;

    const rows = Array.from({ length: count }, (_, i) => {
      const r = emptyRow(name, start + i);
      const c = content[i];
      if (c) for (const k of CONTENT_KEYS) if (c[k] !== undefined) (r as unknown as Record<string, unknown>)[k] = c[k];
      // A brought-across row's photos were matched to its old number.
      if (c) r.photos = [];
      return r;
    });
    return tx.vintageDropDraft.create({
      data: { drop: name, rows: rows as unknown as Prisma.InputJsonValue },
    });
  });
  const draft = view(created);
  return {
    draft,
    beyondPreassigned: draft.rows.filter((r) => Number(r.itemNumber) > LAST_PREASSIGNED_ITEM).length,
  };
}

/**
 * Save what was written. Content only, matched on rowId: which rows exist and
 * what numbers they hold are the server's, so a stale tab cannot resurrect a
 * deleted row or an old number. `revision` must match, or nothing is saved.
 */
export async function saveDraftContent(
  id: string,
  revision: number,
  rows: (Partial<DraftRowContent> & { rowId: string })[],
  opts: { clearNotice?: boolean } = {}
): Promise<{ revision: number }> {
  return prisma.$transaction(async (tx) => {
    const d = await tx.vintageDropDraft.findUnique({ where: { id } });
    if (!d) throw new DraftError("Draft not found.", 404);
    if (d.revision !== revision)
      throw new DraftError("This drop changed elsewhere (or its numbers moved). Reloading it.", 409);
    const byId = new Map(rows.map((r) => [r.rowId, r]));
    const next = rowsOf(d).map((r) => {
      const c = byId.get(r.rowId);
      if (!c) return r;
      const out = { ...r };
      for (const k of CONTENT_KEYS) if (c[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = c[k];
      return toRow(out, d.drop);
    });
    const saved = await tx.vintageDropDraft.update({
      where: { id },
      data: {
        rows: next as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
        ...(opts.clearNotice ? { notice: null } : {}),
      },
    });
    return { revision: saved.revision };
  });
}

/** Grow (empty rows at the end) or shrink (rows off the end). Later drafts move. */
export async function resizeDraft(id: string, count: number): Promise<{ draft: DraftView; moved: Moved[] }> {
  if (!Number.isInteger(count) || count < 1 || count > 300) throw new DraftError("Between 1 and 300 garments.");
  const moved = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK);
    const all = await tx.vintageDropDraft.findMany();
    const d = all.find((x) => x.id === id);
    if (!d) throw new DraftError("Draft not found.", 404);
    const anchor = anchorOf(all);
    const rows = rowsOf(d);
    let next = rows.slice(0, count);
    // New rows get a placeholder just past the end; the pack gives them their
    // real numbers along with everyone else.
    for (let i = rows.length; i < count; i++) next = [...next, emptyRow(d.drop, (rows[rows.length - 1]?.itemNumber ?? 0) + 1 + i)];
    await tx.vintageDropDraft.update({
      where: { id },
      data: { rows: next as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
    });
    return (await repack(tx, anchor)).filter((m) => m.drop !== d.drop);
  });
  return { draft: await getDraft(id), moved };
}

/** Take particular garments out of a drop. Later rows and drafts close up. */
export async function removeDraftRows(id: string, rowIds: string[]): Promise<{ draft: DraftView | null; moved: Moved[] }> {
  let gone = false;
  let dropName = "";
  const moved = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK);
    const all = await tx.vintageDropDraft.findMany();
    const d = all.find((x) => x.id === id);
    if (!d) throw new DraftError("Draft not found.", 404);
    dropName = d.drop;
    const anchor = anchorOf(all);
    const drop = new Set(rowIds);
    const next = rowsOf(d).filter((r) => !drop.has(r.rowId));
    if (!next.length) {
      await tx.vintageDropDraft.delete({ where: { id } });
      gone = true;
    } else
      await tx.vintageDropDraft.update({
        where: { id },
        data: { rows: next as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
      });
    return repack(tx, anchor);
  });
  return { draft: gone ? null : await getDraft(id), moved: moved.filter((m) => m.drop !== dropName) };
}

export async function deleteDraft(id: string): Promise<{ moved: Moved[] }> {
  const moved = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK);
    const all = await tx.vintageDropDraft.findMany();
    if (!all.some((x) => x.id === id)) throw new DraftError("Draft not found.", 404);
    const anchor = anchorOf(all);
    await tx.vintageDropDraft.delete({ where: { id } });
    return repack(tx, anchor);
  });
  return { moved };
}

/**
 * The rows a Create is about to write, as the server numbers them. The sheet's
 * idea of a number is never trusted for a write: item number and barcode come
 * from here, matched on rowId.
 */
export async function rowsForCreate(id: string, rowIds: string[]): Promise<{ drop: string; rows: DraftRowView[] }> {
  const d = await getDraft(id);
  const byId = new Map(d.rows.map((r) => [r.rowId, r]));
  const missing = rowIds.filter((r) => !byId.has(r));
  if (missing.length) throw new DraftError("Some garments are no longer in this drop — reload it.", 409);
  return { drop: d.drop, rows: rowIds.map((r) => byId.get(r)!) };
}

/** Created garments leave the draft; an emptied draft goes. Numbers stay put. */
export async function markCreated(id: string, rowIds: string[]): Promise<{ remaining: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK);
    const d = await tx.vintageDropDraft.findUnique({ where: { id } });
    if (!d) return { remaining: 0 };
    const done = new Set(rowIds);
    const next = rowsOf(d).filter((r) => !done.has(r.rowId));
    if (!next.length) {
      await tx.vintageDropDraft.delete({ where: { id } });
      return { remaining: 0 };
    }
    await tx.vintageDropDraft.update({
      where: { id },
      data: { rows: next as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
    });
    return { remaining: next.length };
  });
}
