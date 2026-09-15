// Size systems: named, ordered size runs that the product builder mints
// variants from.
//
// Sizes used to be `BrandTemplate.sizes String[]` — free text, unordered — and
// the ordering every consumer needs was duplicated as ad-hoc constants in
// barcode-inference.ts and lookup.ts. That is why a size run's order could not
// be trusted anywhere, and why the Sitoo size-run rotation took a phone call to
// two stores to settle.
//
// Two rules hold this together:
//
//  - An entry is ARCHIVED, never deleted, when a size stops being bought.
//    `Variant` stores plain strings with no FK here, so nothing breaks either
//    way — but the row is the record of what the run once was, and a retired
//    size still has stock and order history behind it.
//
//  - `skuToken` is stored, not derived. A 2-D size must spell as four digits
//    (see sku.ts sizeSkuToken), and a half size must survive intact, which it
//    would not if it met abbreviate(). Storing it also means one odd size is a
//    data fix rather than a code change.

import { prisma } from "@/lib/db";
import { sizeSkuToken } from "./sku";
import type { SizeSystemKind } from "@/generated/prisma/enums";

export interface SizeEntryInput {
  sizeLabel?: string;
  dim1: string;
  dim2?: string | null;
  /** Override the derived token. Rare — an odd size whose SKU spelling is fixed. */
  skuToken?: string | null;
}

export interface SizeEntryView {
  id: string;
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
  skuToken: string;
  position: number;
  archived: boolean;
}

export interface SizeSystemView {
  id: string;
  name: string;
  kind: SizeSystemKind;
  note: string | null;
  archived: boolean;
  entries: SizeEntryView[];
  /** Brands defaulting to this system — shown so a rename is not a surprise. */
  brands: { id: string; name: string }[];
}

export class SizeSystemError extends Error {}

/**
 * The label a size is known by, when the caller has not written one.
 *
 * 2-D reads "W32/L34" — the spelling normalize-size-labels.ts canonicalised the
 * whole catalogue to, so a new system agrees with every existing variant.
 */
export function deriveSizeLabel(e: SizeEntryInput): string {
  const a = e.dim1.trim();
  const b = e.dim2?.trim();
  if (e.sizeLabel?.trim()) return e.sizeLabel.trim();
  return b ? `W${a}/L${b}` : a;
}

function normalizeEntry(e: SizeEntryInput, kind: SizeSystemKind) {
  const dim1 = e.dim1.trim();
  if (!dim1) throw new SizeSystemError("Every size needs a value.");
  const dim2 = kind === "TWO_D" ? (e.dim2?.trim() || null) : null;
  if (kind === "TWO_D" && !dim2)
    throw new SizeSystemError(`Size "${dim1}" needs a second dimension in a W/L system.`);
  return {
    sizeLabel: deriveSizeLabel({ ...e, dim1, dim2 }),
    dim1,
    dim2,
    skuToken: (e.skuToken?.trim() || sizeSkuToken({ dim1, dim2 })).toUpperCase(),
  };
}

export async function listSizeSystems(
  opts: { includeArchived?: boolean } = {}
): Promise<SizeSystemView[]> {
  const rows = await prisma.sizeSystem.findMany({
    where: opts.includeArchived ? {} : { archived: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      note: true,
      archived: true,
      entries: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          sizeLabel: true,
          dim1: true,
          dim2: true,
          skuToken: true,
          position: true,
          archived: true,
        },
      },
      templates: { select: { brand: { select: { id: true, name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    note: r.note,
    archived: r.archived,
    entries: r.entries,
    brands: r.templates.map((t) => t.brand),
  }));
}

export interface CreateSizeSystemInput {
  name: string;
  kind: SizeSystemKind;
  note?: string | null;
  entries: SizeEntryInput[];
}

export async function createSizeSystem(input: CreateSizeSystemInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new SizeSystemError("A size system needs a name.");
  if (input.kind === "ONE_SIZE" && input.entries.length > 1)
    throw new SizeSystemError("A one-size system holds exactly one size.");

  const entries =
    input.kind === "ONE_SIZE"
      ? [{ sizeLabel: "One size", dim1: "OS", dim2: null, skuToken: "OS" }]
      : input.entries.map((e) => normalizeEntry(e, input.kind));

  if (!entries.length) throw new SizeSystemError("Add at least one size.");
  assertNoDuplicateLabels(entries);

  const created = await prisma.sizeSystem.create({
    data: {
      name,
      kind: input.kind,
      note: input.note?.trim() || null,
      entries: { create: entries.map((e, i) => ({ ...e, position: i })) },
    },
    select: { id: true },
  });
  return created.id;
}

export interface UpdateSizeSystemInput {
  name?: string;
  note?: string | null;
  archived?: boolean;
  /** Full ordered list. Existing entries are matched by id; new ones have none. */
  entries?: Array<SizeEntryInput & { id?: string; archived?: boolean }>;
}

/**
 * Update a system in place.
 *
 * Entries are reconciled, not replaced: an entry present in the payload keeps
 * its id (and therefore its history), one absent from it is ARCHIVED rather
 * than deleted, and a new one is appended. Replacing the set wholesale would
 * mean a reordering silently destroyed and recreated every size — which is
 * precisely how a size run ends up shifted, and this catalogue has already paid
 * for that once.
 */
export async function updateSizeSystem(id: string, input: UpdateSizeSystemInput): Promise<void> {
  const system = await prisma.sizeSystem.findUnique({
    where: { id },
    select: { id: true, kind: true, entries: { select: { id: true } } },
  });
  if (!system) throw new SizeSystemError("Size system not found.");

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new SizeSystemError("A size system needs a name.");
    data.name = name;
  }
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  if (input.archived !== undefined) data.archived = input.archived;

  if (!input.entries) {
    if (Object.keys(data).length) await prisma.sizeSystem.update({ where: { id }, data });
    return;
  }

  const normalized = input.entries.map((e) => ({
    ...normalizeEntry(e, system.kind),
    id: e.id,
    archived: e.archived ?? false,
  }));
  assertNoDuplicateLabels(normalized.filter((e) => !e.archived));

  const keptIds = new Set(normalized.map((e) => e.id).filter(Boolean) as string[]);
  const droppedIds = system.entries.map((e) => e.id).filter((eid) => !keptIds.has(eid));

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.sizeSystem.update({ where: { id }, data });

    for (const [i, e] of normalized.entries()) {
      const payload = {
        sizeLabel: e.sizeLabel,
        dim1: e.dim1,
        dim2: e.dim2,
        skuToken: e.skuToken,
        position: i,
        archived: e.archived,
      };
      if (e.id) await tx.sizeSystemEntry.update({ where: { id: e.id }, data: payload });
      else await tx.sizeSystemEntry.create({ data: { ...payload, sizeSystemId: id } });
    }

    // Removed from the list = retired, not erased.
    if (droppedIds.length)
      await tx.sizeSystemEntry.updateMany({
        where: { id: { in: droppedIds } },
        data: { archived: true },
      });
  });
}

function assertNoDuplicateLabels(entries: Array<{ sizeLabel: string }>): void {
  const seen = new Set<string>();
  for (const e of entries) {
    const key = e.sizeLabel.toUpperCase();
    if (seen.has(key)) throw new SizeSystemError(`"${e.sizeLabel}" is listed twice.`);
    seen.add(key);
  }
}

/**
 * Expand a compact range into entries: "39-46", "S,M,L", "28-36 x 30,32,34".
 *
 * Typing a shoe run one box at a time is the kind of friction that makes people
 * keep using the spreadsheet.
 */
export function parseSizeRange(input: string, kind: SizeSystemKind): SizeEntryInput[] {
  const text = input.trim();
  if (!text) return [];

  if (kind === "TWO_D") {
    const [waists, lengths] = text.split(/\s*[x×]\s*/i);
    if (!lengths) throw new SizeSystemError('A W/L system needs "waists x lengths", e.g. "28-36 x 30,32,34".');
    const out: SizeEntryInput[] = [];
    for (const w of expandOneDim(waists)) {
      for (const l of expandOneDim(lengths)) out.push({ dim1: w, dim2: l });
    }
    return out;
  }
  return expandOneDim(text).map((v) => ({ dim1: v }));
}

function expandOneDim(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/\s*,\s*/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from) throw new SizeSystemError(`"${part}" counts backwards.`);
      if (to - from > 80) throw new SizeSystemError(`"${part}" is too wide a range.`);
      for (let n = from; n <= to; n++) out.push(String(n));
    } else {
      out.push(part.trim());
    }
  }
  return out;
}
