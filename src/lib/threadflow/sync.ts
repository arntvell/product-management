// Threadflow -> master ingestion (Phase 1).
// Upserts Style -> Colorway -> Variant + per-season data. Idempotent and
// non-destructive: matches on stable Threadflow ids, never deletes on absence,
// keeps barcodes once set, and never clobbers a populated customs field with an
// empty value (docs/product-master-architecture.md §5.2). TF-sourced fields
// only — manager-authored enrichment columns are never touched.
//
// Performance: the DB is remote, so we minimise round-trips — preload existing
// rows, resolve ids in memory, then `createMany` new rows and run updates in
// batched transactions rather than one upsert per entity.
//
// Shape: the run is split into a read-only PLAN and an EXECUTE phase. Everything
// that decides what should happen — resolving ids, working out each colorway's
// desired SKU, and finding the collisions — happens before a single write op is
// constructed. That is what lets a conflict be a skipped item instead of a
// failed run, and it is what `previewSeason` returns.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { DUPLICATE_SKUS } from "@/lib/master/regroup-styles";
import { getManufacturers, getSeasonProducts } from "./client";
import type { TFColorway, TFStyle, TFVariant } from "./types";

export type SyncMode = "full" | "no-images";

export const SYNC_MODES: readonly SyncMode[] = ["full", "no-images"];

export function isSyncMode(v: unknown): v is SyncMode {
  return typeof v === "string" && (SYNC_MODES as readonly string[]).includes(v);
}

export interface SyncCounts {
  styles: number;
  colorways: number;
  variants: number;
  prices: number;
  manufacturers: number;
  images: number;
  /** Colorways the run deliberately did not write. */
  skipped: number;
}

/** One side of a SKU collision, described well enough to act on. */
export interface ColorwaySide {
  id: string;
  colorwaySku: string;
  name: string;
  source: string;
  archived: boolean;
  status: string;
  variantCount: number;
  withBarcodes: number;
  seasons: string[];
  channels: string[];
  styleSku: string;
}

/**
 * A colorway the run chose not to write, with both sides of the collision and a
 * concrete next action. Structured rather than a string so the UI can render it
 * and so nothing important gets lost in prose.
 */
export interface SkippedItem {
  kind: "sku-conflict" | "duplicate-resolution" | "write-failed";
  seasonCode: string;
  styleSku: string;
  styleName: string;
  incoming: {
    colorwaySku: string;
    colorwayId: string;
    name: string;
    variantCount: number;
  };
  /** The local row Threadflow's colorway id matched. */
  local: ColorwaySide | null;
  /** The local row already holding the SKU we want. */
  blocker: ColorwaySide | null;
  message: string;
  suggestion: string;
}

export interface PlannedCounts {
  styleCreates: number;
  styleUpdates: number;
  colorwayCreates: number;
  colorwayUpdates: number;
  variantCreates: number;
  variantUpdates: number;
  entryCreates: number;
  entryUpdates: number;
  priceRows: number;
  imageRows: number;
  manufacturerCreates: number;
  manufacturerUpdates: number;
}

export interface SyncPreview {
  seasonCode: string;
  mode: SyncMode;
  planned: PlannedCounts;
  renames: { colorwayId: string; from: string; to: string }[];
  parks: { colorwayId: string; from: string; to: string; reason: string }[];
  repoints: {
    incomingColorwayId: string;
    fromLocalId: string;
    toLocalId: string;
    reason: string;
  }[];
  skipped: SkippedItem[];
  warnings: string[];
  durationMs: number;
}

export interface SyncResult extends Omit<SyncPreview, "planned"> {
  syncRunId: string;
  status: "ok" | "partial" | "failed";
  counts: SyncCounts;
  planned: PlannedCounts;
  /** Real failures only. Informational notes live in `warnings`. */
  errors: string[];
}

// How many independent writes to keep in flight at once. Concurrency hides the
// per-query network latency without the 5s cap of an interactive transaction.
const CONCURRENCY = 15;

function hasValue(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Livid vendor label derived from gender/unisex (Shopify-facing). */
function deriveVendor(gender: string | null, unisex: boolean): string {
  if (unisex) return "Livid Unisex";
  const g = gender?.toLowerCase();
  if (g === "women") return "Livid Femme";
  if (g === "men") return "Livid Men";
  return "Livid";
}

/**
 * Strip a dimension's own letter prefix. Threadflow ships the length already
 * prefixed ("L32") while Cin7 ships it bare ("32"), so without this the label
 * comes out "W27/LL32" and the two sources disagree on `dim2` — which makes any
 * size-based comparison across them unreliable and sends Loom two shapes for
 * the same measurement.
 */
function stripDimPrefix(v: string, prefix: "W" | "L"): string {
  return v.trim().replace(new RegExp(`^${prefix}+`, "i"), "");
}

function deriveSize(dims: TFVariant["dimensions"]): {
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
} {
  if (hasValue(dims.waist) || hasValue(dims.length)) {
    const waist = stripDimPrefix(dims.waist ?? "", "W");
    const length = stripDimPrefix(dims.length ?? "", "L");
    return { sizeLabel: `W${waist}/L${length}`, dim1: waist, dim2: length };
  }
  // One-dimensional sizes are letters ("M", "L", "XL") — never prefix-stripped,
  // or "L" for Large would become an empty string.
  const size = dims.size ?? "";
  return { sizeLabel: size, dim1: size, dim2: null };
}

// ---------------------------------------------------------------------------
// Write execution: identified, lazily-constructed ops
// ---------------------------------------------------------------------------

/**
 * A write, tagged with what it is and which colorway it belongs to, and built
 * on demand.
 *
 * Lazy rather than an eager `PrismaPromise` for two reasons: a colorway that
 * turns out to be suppressed never constructs anything at all, and a
 * `PrismaPromise` resolves once — a "retry this row on its own" fallback over an
 * already-awaited promise would just replay the cached rejection.
 */
interface TaggedOp {
  colorwayId?: string;
  label: string;
  make: () => Prisma.PrismaPromise<unknown>;
}

interface OpFailure {
  label: string;
  colorwayId?: string;
  message: string;
}

function op(
  label: string,
  colorwayId: string | undefined,
  make: () => Prisma.PrismaPromise<unknown>
): TaggedOp {
  return { label, colorwayId, make };
}

/** Turn a Prisma error into something a human can act on. */
function describeDbError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code?: string; meta?: Record<string, unknown> };
    const target = e.meta?.target;
    const fields = Array.isArray(target) ? target.join(", ") : String(target ?? "");
    if (e.code === "P2002")
      return `another row already holds this value for ${fields || "a unique field"}`;
    if (e.code === "P2003" || e.code === "P2025")
      return `related row missing (${e.code})`;
    if (e.code) return `${e.code}${fields ? ` on ${fields}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run independent writes with bounded concurrency, reporting per-row failures
 * instead of aborting. Not wrapped in a transaction — the sync is idempotent, so
 * cross-row atomicity isn't needed, and this avoids the interactive-transaction
 * time limit.
 */
async function runBatched(ops: TaggedOp[]): Promise<OpFailure[]> {
  const failures: OpFailure[] = [];
  for (let i = 0; i < ops.length; i += CONCURRENCY) {
    const slice = ops.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((o) => o.make()));
    settled.forEach((r, j) => {
      if (r.status === "rejected") {
        failures.push({
          label: slice[j].label,
          colorwayId: slice[j].colorwayId,
          message: describeDbError(r.reason),
        });
      }
    });
  }
  return failures;
}

/**
 * `createMany` is all-or-nothing, so one bad row used to kill the whole run.
 * Try the bulk insert; on rejection fall back to per-row creates through the
 * same isolation path so a single bad row becomes a single named skip.
 */
async function createManyWithFallback<T>(
  rows: T[],
  bulk: (data: T[]) => Prisma.PrismaPromise<unknown>,
  one: (row: T) => Prisma.PrismaPromise<unknown>,
  describe: (row: T) => { label: string; colorwayId?: string }
): Promise<OpFailure[]> {
  if (!rows.length) return [];
  try {
    await bulk(rows);
    return [];
  } catch {
    // Fall through: find out which rows are actually bad.
  }
  return runBatched(
    rows.map((r) => {
      const d = describe(r);
      return op(d.label, d.colorwayId, () => one(r));
    })
  );
}

/** Read existing rows in chunks (keeps the `IN (...)` param count sane). */
async function chunkedFind<T>(
  keys: string[],
  finder: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    out.push(...(await finder(keys.slice(i, i + 1000))));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface PlannedStyle {
  tf: TFStyle;
  id: string;
  wasNew: boolean;
  vendor: string;
  productType: string | null;
}

interface PlannedColorway {
  tf: TFColorway;
  style: PlannedStyle;
  localId: string;
  wasNew: boolean;
  desiredSku: string;
  matchedBy: "threadflowId" | "colorwaySku" | "new";
  skip?: SkippedItem;
}

/** A blocker row, selected with enough context to describe the collision. */
type BlockerRow = {
  id: string;
  colorwaySku: string;
  name: string;
  source: string;
  archived: boolean;
  status: string;
  threadflowId: string | null;
  style: { styleSku: string };
  _count: { variants: number };
  variants: { barcode: string | null }[];
  entries: { season: { code: string } }[];
  publications: { channel: string }[];
};

function toSide(b: BlockerRow): ColorwaySide {
  return {
    id: b.id,
    colorwaySku: b.colorwaySku,
    name: b.name,
    source: String(b.source),
    archived: b.archived,
    status: String(b.status),
    variantCount: b._count.variants,
    withBarcodes: b.variants.filter((v) => hasValue(v.barcode)).length,
    seasons: [...new Set(b.entries.map((e) => e.season.code))].sort(),
    channels: [...new Set(b.publications.map((p) => String(p.channel)))].sort(),
    styleSku: b.style.styleSku,
  };
}

const BLOCKER_SELECT = {
  id: true,
  colorwaySku: true,
  name: true,
  source: true,
  archived: true,
  status: true,
  threadflowId: true,
  style: { select: { styleSku: true } },
  _count: { select: { variants: true } },
  variants: { select: { barcode: true } },
  entries: { select: { season: { select: { code: true } } } },
  publications: { select: { channel: true } },
} as const;

interface SkuPlan {
  /** Rows to move out of the way, freeing a SKU for its rightful owner. */
  parks: {
    colorwayId: string;
    from: string;
    to: string;
    reason: string;
    clearThreadflowId: boolean;
  }[];
  /** Rows whose SKU changes, applied two-phase so a rotation can't self-collide. */
  renames: { colorwayId: string; from: string; to: string }[];
  repoints: {
    incomingColorwayId: string;
    fromLocalId: string;
    toLocalId: string;
    reason: string;
  }[];
  skipped: SkippedItem[];
  warnings: string[];
}

/**
 * Work out how to make every colorway's desired SKU reachable. Read-only: it
 * decides, `applySkuReconciliation` writes.
 *
 * Three things break a naive rename, and all three are Threadflow's shape rather
 * than ours:
 *
 *  - Rotation. Threadflow can move a SKU from one colorway to another in the
 *    same season — Fuller Chino's "Oyster" SKU moving from Khaki to Beige while
 *    Khaki takes a new one. Applying those one at a time hits the unique index
 *    whichever order you choose, so every changing row goes to a temporary SKU
 *    first and lands on its real one after.
 *
 *  - Empty or withdrawn duplicates. Threadflow issues a colorway id per season,
 *    so the same garment can exist twice under one SKU. A row with no sizes, or
 *    one already archived, yields the SKU and keeps a parked one — nothing is
 *    deleted, and the real record wins.
 *
 *  - Two live rows for one garment. Both sides are somebody's real product, so
 *    there is no safe automatic winner: refuse, and report it well enough that
 *    a human can merge them.
 */
async function planSkuReconciliation(
  planned: PlannedColorway[],
  seasonCode: string
): Promise<SkuPlan> {
  const plan: SkuPlan = {
    parks: [],
    renames: [],
    repoints: [],
    skipped: [],
    warnings: [],
  };

  const live = planned.filter((p) => !p.skip && !p.wasNew);
  const byLocalId = new Map(live.map((p) => [p.localId, p]));
  const ids = [...byLocalId.keys()];
  if (!ids.length) return plan;

  const current = await chunkedFind(ids, (chunk) =>
    prisma.colorway.findMany({
      where: { id: { in: chunk } },
      select: { id: true, colorwaySku: true, threadflowId: true },
    })
  );
  const currentById = new Map(current.map((c) => [c.id, c]));

  let changing = ids.filter((id) => {
    const row = currentById.get(id);
    return row && row.colorwaySku !== byLocalId.get(id)!.desiredSku;
  });
  if (!changing.length) return plan;

  // Anything else already sitting on a SKU we need.
  const wanted = changing.map((id) => byLocalId.get(id)!.desiredSku);
  const blockers = (
    await chunkedFind(wanted, (chunk) =>
      prisma.colorway.findMany({
        where: { colorwaySku: { in: chunk } },
        select: BLOCKER_SELECT,
      })
    )
  ).filter((b) => !changing.includes(b.id)) as BlockerRow[];

  const drop = (localId: string) => {
    changing = changing.filter((id) => id !== localId);
  };

  for (const b of blockers) {
    const claimants = changing.filter(
      (id) => byLocalId.get(id)!.desiredSku === b.colorwaySku
    );
    if (!claimants.length) continue;

    for (const localId of claimants) {
      const p = byLocalId.get(localId)!;
      const mine = currentById.get(localId)!;

      // Self-heal: this row is a duplicate WE parked on an earlier run, and the
      // blocker is the record that took its SKU. Re-point the incoming colorway
      // at the blocker instead of fighting for a SKU it should never have kept.
      // Narrow on purpose — `--dup-` is a string only this code mints, and the
      // threadflowId check proves it is the same Threadflow colorway.
      const isOurParkedDup =
        mine.colorwaySku.startsWith(`${p.desiredSku}--dup-`) &&
        mine.threadflowId === p.tf.colorway_id;
      const parkedIsEmpty =
        isOurParkedDup &&
        (await prisma.colorway
          .findUnique({
            where: { id: localId },
            select: { _count: { select: { variants: true } } },
          })
          .then((r) => (r?._count.variants ?? 1) === 0));

      if (isOurParkedDup && parkedIsEmpty) {
        plan.repoints.push({
          incomingColorwayId: p.tf.colorway_id,
          fromLocalId: localId,
          toLocalId: b.id,
          reason: `parked duplicate of ${b.colorwaySku}`,
        });
        plan.parks.push({
          colorwayId: localId,
          from: mine.colorwaySku,
          to: mine.colorwaySku,
          reason: "retire the parked duplicate and release its Threadflow id",
          clearThreadflowId: true,
        });
        plan.warnings.push(
          `${seasonCode} · ${p.style.tf.style_sku} · ${p.desiredSku}: "${p.tf.name}" was a duplicate row we parked earlier ` +
            `(${mine.colorwaySku}, 0 sizes). Re-pointed onto the record that holds the SKU ` +
            `("${b.name}", ${b._count.variants} sizes) and retired the duplicate.`
        );
        // The incoming colorway now targets the blocker, which already holds the
        // desired SKU — nothing to rename.
        p.localId = b.id;
        drop(localId);
        continue;
      }

      const side = toSide(b);
      const yieldable =
        (b._count.variants === 0 || b.archived || String(b.status) === "ARCHIVED") &&
        b.publications.length === 0;

      if (yieldable) {
        const parked = `${b.colorwaySku}--dup-${(b.threadflowId ?? b.id).slice(0, 8)}`;
        plan.parks.push({
          colorwayId: b.id,
          from: b.colorwaySku,
          to: parked,
          reason:
            b._count.variants === 0
              ? "no sizes"
              : "already archived",
          // A parked row must not keep a live Threadflow id, or the next sync of
          // that season matches it again, wants its SKU back, and is refused
          // forever. That is exactly how the FW26 duplicates became permanent.
          clearThreadflowId: true,
        });
        plan.warnings.push(
          `${seasonCode} · ${p.style.tf.style_sku} · ${b.colorwaySku} was held by "${b.name}" ` +
            `(${side.source}, ${b._count.variants} sizes, ${b.archived ? "archived" : "unpublished"}); ` +
            `parked as ${parked} so "${p.tf.name}" can take it.`
        );
        continue;
      }

      // Two live records for one garment. Refuse, and say enough to fix it.
      const localSide = await describeLocal(localId);
      plan.skipped.push(
        buildSkuConflict(seasonCode, p, localSide, side)
      );
      p.skip = plan.skipped[plan.skipped.length - 1];
      drop(localId);
    }
  }

  for (const id of changing) {
    plan.renames.push({
      colorwayId: id,
      from: currentById.get(id)!.colorwaySku,
      to: byLocalId.get(id)!.desiredSku,
    });
  }

  return plan;
}

async function describeLocal(id: string): Promise<ColorwaySide | null> {
  const row = (await prisma.colorway.findUnique({
    where: { id },
    select: BLOCKER_SELECT,
  })) as BlockerRow | null;
  return row ? toSide(row) : null;
}

/**
 * Known Cin7 duplicates of Threadflow colorways, declared when the Cin7 imports
 * were re-modelled as colorways under real parent styles. Used for the
 * suggestion text only — the merge itself takes its pairs from the detector, so
 * a pair that appears tomorrow is still reported properly.
 */
const KNOWN_CIN7_DUPLICATES = new Set<string>(DUPLICATE_SKUS);

function buildSkuConflict(
  seasonCode: string,
  p: PlannedColorway,
  local: ColorwaySide | null,
  blocker: ColorwaySide
): SkippedItem {
  const incomingSizes = p.tf.variants.length;
  const where = [
    blocker.source,
    `${blocker.variantCount} sizes`,
    blocker.withBarcodes ? `${blocker.withBarcodes} barcodes` : null,
    blocker.seasons.length ? `seasons ${blocker.seasons.join("+")}` : null,
    blocker.channels.length ? `published to ${blocker.channels.join("+")}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const message =
    `Threadflow colorway "${p.tf.name}" (${p.tf.colorway_id.slice(0, 8)}, ${incomingSizes} sizes) ` +
    `wants SKU ${p.desiredSku}, which is held by "${blocker.name}" (${where}). ` +
    (local
      ? `Nothing was written for our "${local.name}" (${local.colorwaySku}, ${local.variantCount} sizes), ` +
        `so no barcodes moved.`
      : `Nothing was written for this colorway.`);

  const sameStyle = !local || local.styleSku === blocker.styleSku;
  let suggestion: string;
  if (KNOWN_CIN7_DUPLICATES.has(blocker.colorwaySku) && blocker.source === "CIN7_IMPORT") {
    suggestion =
      `Known Cin7 duplicate of the Threadflow colorway. Merge ${local?.id ?? "?"} into ${blocker.id} ` +
      `— the blocker carries the barcodes and the channel publication — then re-run.`;
  } else if (local && local.source === "THREADFLOW" && blocker.source === "THREADFLOW") {
    suggestion =
      `Two Threadflow rows for one garment (per-season colorway ids). Merge ${local.id} into ${blocker.id}, then re-run.`;
  } else if (sameStyle) {
    suggestion =
      `Same style and colour on both sides — most likely one garment held twice. ` +
      `Merge ${local?.id ?? "?"} into ${blocker.id}, then re-run.`;
  } else {
    suggestion =
      `Different parent styles (${local?.styleSku ?? "?"} vs ${blocker.styleSku}) — check which SKU is right in Threadflow.`;
  }

  return {
    kind: "sku-conflict",
    seasonCode,
    styleSku: p.style.tf.style_sku,
    styleName: p.style.tf.style_name,
    incoming: {
      colorwaySku: p.desiredSku,
      colorwayId: p.tf.colorway_id,
      name: p.tf.name,
      variantCount: incomingSizes,
    },
    local,
    blocker,
    message,
    suggestion,
  };
}

interface CarriedVariant {
  id: string;
  from: string;
  to: string;
  barcode: string | null;
}

/** Perform what `planSkuReconciliation` decided. */
async function applySkuReconciliation(
  plan: SkuPlan
): Promise<{ notes: string[]; carried: CarriedVariant[] }> {
  const notes: string[] = [];
  const carried: CarriedVariant[] = [];

  for (const park of plan.parks) {
    await prisma.colorway.update({
      where: { id: park.colorwayId },
      data: {
        ...(park.to !== park.from ? { colorwaySku: park.to } : {}),
        ...(park.clearThreadflowId ? { threadflowId: null } : {}),
        archived: true,
        status: "ARCHIVED",
      },
    });
  }

  if (!plan.renames.length) return { notes, carried };

  // Two-phase so a rotation cannot collide with itself.
  const stamp = Date.now().toString(36);
  for (let i = 0; i < plan.renames.length; i++) {
    await prisma.colorway.update({
      where: { id: plan.renames[i].colorwayId },
      data: { colorwaySku: `--sync-${stamp}-${i}` },
    });
  }
  for (const r of plan.renames) {
    await prisma.colorway.update({
      where: { id: r.colorwayId },
      data: { colorwaySku: r.to },
    });

    // Variant SKUs are derived from the colorway's, and the sync matches
    // variants on that SKU — so leaving them behind makes the incoming set look
    // new and every size ends up duplicated, the old copies stranded under the
    // same colorway. Carry them across with the rename.
    const vars = await prisma.variant.findMany({
      where: { colorwayId: r.colorwayId, variantSku: { startsWith: `${r.from}-` } },
      select: { id: true, variantSku: true, barcode: true },
    });
    let carriedHere = 0;
    for (const v of vars) {
      const nextSku = `${r.to}${v.variantSku.slice(r.from.length)}`;
      // Only if nothing else already holds it — a collision here means the
      // incoming set genuinely differs, and the normal variant sync handles it.
      const taken = await prisma.variant.findUnique({
        where: { variantSku: nextSku },
        select: { id: true },
      });
      if (taken) continue;
      await prisma.variant.update({
        where: { id: v.id },
        data: { variantSku: nextSku },
      });
      carried.push({ id: v.id, from: v.variantSku, to: nextSku, barcode: v.barcode });
      carriedHere++;
    }
    notes.push(
      `SKU ${r.from} -> ${r.to}` +
        (carriedHere ? ` (${carriedHere} variant SKUs carried across)` : "")
    );
  }
  return { notes, carried };
}

/**
 * Two incoming colorways resolving to one local row would violate
 * SeasonEntry's (colorwayId, seasonId) unique index and abort the entry writes.
 * Keep the one whose SKU the local row already carries, else the one with more
 * sizes, and report the rest.
 */
async function dedupeByLocalId(
  planned: PlannedColorway[],
  seasonCode: string
): Promise<SkippedItem[]> {
  const out: SkippedItem[] = [];
  const groups = new Map<string, PlannedColorway[]>();
  for (const p of planned) {
    if (p.skip) continue;
    const g = groups.get(p.localId) ?? [];
    g.push(p);
    groups.set(p.localId, g);
  }

  for (const [localId, group] of groups) {
    if (group.length < 2) continue;
    const row = await prisma.colorway.findUnique({
      where: { id: localId },
      select: { colorwaySku: true },
    });
    const winner =
      group.find((p) => p.desiredSku === row?.colorwaySku) ??
      [...group].sort((a, b) => b.tf.variants.length - a.tf.variants.length)[0];
    const side = await describeLocal(localId);
    for (const p of group) {
      if (p === winner) continue;
      const item: SkippedItem = {
        kind: "duplicate-resolution",
        seasonCode,
        styleSku: p.style.tf.style_sku,
        styleName: p.style.tf.style_name,
        incoming: {
          colorwaySku: p.desiredSku,
          colorwayId: p.tf.colorway_id,
          name: p.tf.name,
          variantCount: p.tf.variants.length,
        },
        local: side,
        blocker: null,
        message:
          `Threadflow sends two colorways for one local record: "${p.tf.name}" ` +
          `(${p.tf.colorway_id.slice(0, 8)}, ${p.desiredSku}) and "${winner.tf.name}" ` +
          `(${winner.tf.colorway_id.slice(0, 8)}, ${winner.desiredSku}). Kept the latter.`,
        suggestion:
          `Remove the duplicate colorway in Threadflow, or give the two records distinct SKUs.`,
      };
      p.skip = item;
      out.push(item);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan a season (read-only)
// ---------------------------------------------------------------------------

interface SeasonPlan {
  seasonCode: string;
  mode: SyncMode;
  withImages: boolean;
  seasonId: string | null;
  brandId: string | null;
  manuIdMap: Map<string, string>;
  manufacturerCreates: number;
  manufacturerUpdates: number;
  manufacturerCount: number;
  styles: PlannedStyle[];
  planned: PlannedColorway[];
  skuPlan: SkuPlan;
  variantBySku: Map<string, { id: string; barcode: string | null }>;
  entryIdByColorway: Map<string, string>;
  ownedByColorway: Map<string, Set<string>>;
  warnings: string[];
  skipped: SkippedItem[];
}

async function planSeason(
  seasonCode: string,
  mode: SyncMode,
  dryRun: boolean
): Promise<SeasonPlan> {
  const withImages = mode !== "no-images";
  const warnings: string[] = [];

  // 1. Fetch the season's catalogue + manufacturer master data.
  const [{ season: tfSeason, styles }, manufacturers] = await Promise.all([
    getSeasonProducts(seasonCode, {
      includeUnapproved: true,
      includeDropped: true,
    }),
    getManufacturers(),
  ]);

  // Leftovers from a crash between the two rename phases. Invisible otherwise,
  // and one query to make loud.
  const stranded = await prisma.colorway.count({
    where: { colorwaySku: { startsWith: "--sync-" } },
  });
  if (stranded)
    warnings.push(
      `${stranded} colorway(s) still carry a temporary --sync- SKU from an interrupted run; ` +
        `they need a SKU before they can be published.`
    );

  // 2. Season + brand (Livid — TF products are all Livid).
  let seasonId: string | null;
  let brandId: string | null;
  if (dryRun) {
    const s = await prisma.season.findFirst({
      where: tfSeason.id
        ? { OR: [{ threadflowId: tfSeason.id }, { code: tfSeason.code }] }
        : { code: tfSeason.code },
      select: { id: true },
    });
    seasonId = s?.id ?? null;
    if (!seasonId) warnings.push(`Season ${tfSeason.code} would be created.`);
    const b = await prisma.brand.findUnique({
      where: { name: "Livid" },
      select: { id: true },
    });
    brandId = b?.id ?? null;
  } else {
    const season = await prisma.season.upsert({
      where: tfSeason.id
        ? { threadflowId: tfSeason.id }
        : { code: tfSeason.code },
      create: { code: tfSeason.code, threadflowId: tfSeason.id || null },
      update: { code: tfSeason.code },
    });
    seasonId = season.id;
    const brand = await prisma.brand.upsert({
      where: { name: "Livid" },
      create: { name: "Livid", isLivid: true },
      update: {},
    });
    brandId = brand.id;
  }

  // 3. Manufacturers: bulk create/update, keyed by TF id.
  const manuIdMap = new Map<string, string>();
  let manufacturerCreates = 0;
  let manufacturerUpdates = 0;
  {
    const existing = await prisma.manufacturer.findMany({
      where: {
        threadflowId: { in: manufacturers.map((m) => m.manufacturer_id) },
      },
      select: { id: true, threadflowId: true },
    });
    const existingByTf = new Map(existing.map((m) => [m.threadflowId!, m.id]));
    const creates: Prisma.ManufacturerCreateManyInput[] = [];
    const updates: TaggedOp[] = [];
    for (const m of manufacturers) {
      const data = {
        name: m.name,
        addrLine1: m.address?.line1 ?? null,
        addrLine2: m.address?.line2 ?? null,
        zip: m.address?.zip ?? null,
        city: m.address?.city ?? null,
        country: m.address?.country ?? null,
      };
      const existingId = existingByTf.get(m.manufacturer_id);
      if (existingId) {
        manuIdMap.set(m.manufacturer_id, existingId);
        manufacturerUpdates++;
        updates.push(
          op(`manufacturer ${m.name}`, undefined, () =>
            prisma.manufacturer.update({ where: { id: existingId }, data })
          )
        );
      } else {
        const id = randomUUID();
        manuIdMap.set(m.manufacturer_id, id);
        manufacturerCreates++;
        creates.push({ id, threadflowId: m.manufacturer_id, ...data });
      }
    }
    if (!dryRun) {
      const f1 = await createManyWithFallback(
        creates,
        (data) => prisma.manufacturer.createMany({ data }),
        (row) => prisma.manufacturer.create({ data: row }),
        (row) => ({ label: `manufacturer ${row.name}` })
      );
      const f2 = await runBatched(updates);
      for (const f of [...f1, ...f2])
        warnings.push(`Could not write ${f.label}: ${f.message}`);
    }
  }

  // 4. Preload existing product rows so we can resolve ids in memory.
  const styleTfIds = styles.map((s) => s.style_id);
  const colorways = styles.flatMap((s) => s.colorways);
  const colorwayTfIds = colorways.map((c) => c.colorway_id);
  const colorwaySkusIncoming = colorways.map((c) => c.colorway_sku);
  const variantSkus = colorways.flatMap((c) => c.variants.map((v) => v.sku));

  const existingStyles = await chunkedFind(styleTfIds, (ids) =>
    prisma.style.findMany({
      where: { threadflowId: { in: ids } },
      select: { id: true, threadflowId: true },
    })
  );
  const styleIdByTf = new Map(
    existingStyles.map((s) => [s.threadflowId!, s.id])
  );

  // Threadflow assigns colorway ids PER SEASON, so a carry-over colorway
  // appears in a new season with a fresh colorway_id but the SAME colorway_sku.
  // Match on threadflowId first, then fall back to colorwaySku (the stable
  // natural key) so carry-overs update the existing row instead of colliding
  // on the unique colorwaySku.
  const existingColorways = await chunkedFind(colorwayTfIds, (ids) =>
    prisma.colorway.findMany({
      where: { threadflowId: { in: ids } },
      select: { id: true, threadflowId: true, colorwaySku: true },
    })
  );
  const existingColorwaysBySku = await chunkedFind(
    colorwaySkusIncoming,
    (skus) =>
      prisma.colorway.findMany({
        where: { colorwaySku: { in: skus } },
        select: { id: true, threadflowId: true, colorwaySku: true },
      })
  );
  const colorwayIdByTf = new Map<string, string>();
  const colorwayIdBySku = new Map<string, string>();
  for (const c of [...existingColorways, ...existingColorwaysBySku]) {
    if (c.threadflowId) colorwayIdByTf.set(c.threadflowId, c.id);
    colorwayIdBySku.set(c.colorwaySku, c.id);
  }

  const existingVariants = await chunkedFind(variantSkus, (skus) =>
    prisma.variant.findMany({
      where: { variantSku: { in: skus } },
      select: { id: true, variantSku: true, barcode: true },
    })
  );
  const variantBySku = new Map(
    existingVariants.map((v) => [
      v.variantSku,
      { id: v.id, barcode: v.barcode },
    ])
  );

  const existingEntries = seasonId
    ? await prisma.seasonEntry.findMany({
        where: { seasonId },
        select: { id: true, colorwayId: true },
      })
    : [];
  const entryIdByColorway = new Map(
    existingEntries.map((e) => [e.colorwayId, e.id])
  );

  // Manually-edited (locked) colorway fields — the sync must not clobber them
  // (docs/product-master-architecture.md §5.3).
  const existingColorwayIds = [
    ...new Set([...colorwayIdByTf.values(), ...colorwayIdBySku.values()]),
  ];
  const ownerRows = await chunkedFind(existingColorwayIds, (ids) =>
    prisma.fieldOwner.findMany({
      where: {
        entityType: "colorway",
        entityId: { in: ids },
        owner: "MANUAL",
      },
      select: { entityId: true, field: true },
    })
  );
  const ownedByColorway = new Map<string, Set<string>>();
  for (const r of ownerRows) {
    const set = ownedByColorway.get(r.entityId) ?? new Set<string>();
    set.add(r.field);
    ownedByColorway.set(r.entityId, set);
  }

  // 4a. Resolve every id up front, exactly once per entity. `resolveColorway`
  // mutates its caches, so calling it twice for one colorway is order-dependent
  // and would disagree with itself.
  const plannedStyles: PlannedStyle[] = [];
  const planned: PlannedColorway[] = [];
  for (const s of styles) {
    const wasNew = !styleIdByTf.has(s.style_id);
    const id =
      styleIdByTf.get(s.style_id) ??
      styleIdByTf.set(s.style_id, randomUUID()).get(s.style_id)!;
    const ps: PlannedStyle = {
      tf: s,
      id,
      wasNew,
      vendor: deriveVendor(s.gender, s.unisex),
      productType: s.category || null,
    };
    plannedStyles.push(ps);

    for (const c of s.colorways) {
      const byTf = colorwayIdByTf.get(c.colorway_id);
      const bySku = colorwayIdBySku.get(c.colorway_sku);
      const existingId = byTf ?? bySku;
      const localId = existingId ?? randomUUID();
      // Cache under both keys so later references in this run resolve.
      colorwayIdByTf.set(c.colorway_id, localId);
      colorwayIdBySku.set(c.colorway_sku, localId);
      planned.push({
        tf: c,
        style: ps,
        localId,
        wasNew: !existingId,
        desiredSku: c.colorway_sku,
        matchedBy: byTf ? "threadflowId" : bySku ? "colorwaySku" : "new",
      });
    }
  }

  // 4b/4c. Conflicts, then the same-run guard — run again after reconciliation
  // because re-pointing can create a fresh collision.
  const skipped: SkippedItem[] = [];
  skipped.push(...(await dedupeByLocalId(planned, seasonCode)));
  const skuPlan = await planSkuReconciliation(planned, seasonCode);
  skipped.push(...skuPlan.skipped);
  skipped.push(...(await dedupeByLocalId(planned, seasonCode)));
  warnings.push(...skuPlan.warnings);

  return {
    seasonCode: tfSeason.code || seasonCode,
    mode,
    withImages,
    seasonId,
    brandId,
    manuIdMap,
    manufacturerCreates,
    manufacturerUpdates,
    manufacturerCount: manufacturers.length,
    styles: plannedStyles,
    planned,
    skuPlan,
    variantBySku,
    entryIdByColorway,
    ownedByColorway,
    warnings,
    skipped,
  };
}

function countPlanned(plan: SeasonPlan): PlannedCounts {
  const live = plan.planned.filter((p) => !p.skip);
  let variantCreates = 0;
  let variantUpdates = 0;
  let priceRows = 0;
  let imageRows = 0;
  let entryCreates = 0;
  let entryUpdates = 0;
  const seenEntry = new Set<string>();
  for (const p of live) {
    for (const v of p.tf.variants) {
      if (plan.variantBySku.has(v.sku)) variantUpdates++;
      else variantCreates++;
    }
    for (const pr of Object.values(p.tf.prices ?? {})) {
      if (typeof pr?.msrp === "number") priceRows++;
      if (typeof pr?.ws === "number") priceRows++;
    }
    if (plan.withImages && hasValue(p.tf.image)) imageRows++;
    if (seenEntry.has(p.localId)) continue;
    seenEntry.add(p.localId);
    if (plan.entryIdByColorway.has(p.localId)) entryUpdates++;
    else entryCreates++;
  }
  return {
    styleCreates: plan.styles.filter((s) => s.wasNew).length,
    styleUpdates: plan.styles.filter((s) => !s.wasNew).length,
    colorwayCreates: live.filter((p) => p.wasNew).length,
    colorwayUpdates: live.filter((p) => !p.wasNew).length,
    variantCreates,
    variantUpdates,
    entryCreates,
    entryUpdates,
    priceRows,
    imageRows,
    manufacturerCreates: plan.manufacturerCreates,
    manufacturerUpdates: plan.manufacturerUpdates,
  };
}

/**
 * What a sync would do, without doing any of it. No SyncRun row is written —
 * creating one is itself a write.
 */
export async function previewSeason(
  seasonCode: string,
  mode: SyncMode = "full"
): Promise<SyncPreview> {
  const started = Date.now();
  const plan = await planSeason(seasonCode, mode, true);
  return {
    seasonCode: plan.seasonCode,
    mode,
    planned: countPlanned(plan),
    renames: plan.skuPlan.renames,
    parks: plan.skuPlan.parks.map((p) => ({
      colorwayId: p.colorwayId,
      from: p.from,
      to: p.to,
      reason: p.reason,
    })),
    repoints: plan.skuPlan.repoints,
    skipped: plan.skipped,
    warnings: plan.warnings,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export async function syncSeason(
  seasonCode: string,
  mode: SyncMode = "full"
): Promise<SyncResult> {
  const started = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const skipped: SkippedItem[] = [];
  const counts: SyncCounts = {
    styles: 0,
    colorways: 0,
    variants: 0,
    prices: 0,
    manufacturers: 0,
    images: 0,
    skipped: 0,
  };
  let planned: PlannedCounts = {
    styleCreates: 0,
    styleUpdates: 0,
    colorwayCreates: 0,
    colorwayUpdates: 0,
    variantCreates: 0,
    variantUpdates: 0,
    entryCreates: 0,
    entryUpdates: 0,
    priceRows: 0,
    imageRows: 0,
    manufacturerCreates: 0,
    manufacturerUpdates: 0,
  };
  let renames: SyncPreview["renames"] = [];
  let parks: SyncPreview["parks"] = [];
  let repoints: SyncPreview["repoints"] = [];
  let resolvedSeasonCode = seasonCode;

  const run = await prisma.syncRun.create({
    data: { source: "threadflow", mode, seasonCode, status: "running" },
  });

  const finish = async (status: "ok" | "partial" | "failed"): Promise<SyncResult> => {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status,
        counts: counts as unknown as Prisma.InputJsonValue,
        errors,
        warnings: warnings as unknown as Prisma.InputJsonValue,
        skipped: skipped as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      syncRunId: run.id,
      seasonCode: resolvedSeasonCode,
      mode,
      status,
      counts,
      planned,
      renames,
      parks,
      repoints,
      skipped,
      warnings,
      errors,
      durationMs: Date.now() - started,
    };
  };

  try {
    const plan = await planSeason(seasonCode, mode, false);
    resolvedSeasonCode = plan.seasonCode;
    warnings.push(...plan.warnings);
    skipped.push(...plan.skipped);
    planned = countPlanned(plan);
    renames = plan.skuPlan.renames;
    parks = plan.skuPlan.parks.map((p) => ({
      colorwayId: p.colorwayId,
      from: p.from,
      to: p.to,
      reason: p.reason,
    }));
    repoints = plan.skuPlan.repoints;
    counts.manufacturers = plan.manufacturerCount;

    // planSeason upserts both when it is not a dry run; be explicit rather than
    // asserting, because a silent undefined here would write orphaned rows.
    if (!plan.seasonId || !plan.brandId)
      throw new Error("Season or brand missing after plan — nothing was written");
    const seasonId = plan.seasonId;
    const brandId = plan.brandId;

    // 4d. Free every SKU that can be freed, before anything asserts one.
    const reconciled = await applySkuReconciliation(plan.skuPlan);
    warnings.push(...reconciled.notes);

    // The variant lookup was preloaded on the OLD SKUs, so without this every
    // size that just moved looks new, `variantCreates` asserts the SKU the
    // rename has already taken, and the whole size run is skipped for a run.
    for (const c of reconciled.carried) {
      plan.variantBySku.delete(c.from);
      plan.variantBySku.set(c.to, { id: c.id, barcode: c.barcode });
    }

    // 5. Build write ops for everything that survived the plan.
    const styleCreates: Prisma.StyleCreateManyInput[] = [];
    const styleUpdates: TaggedOp[] = [];
    const colorwayCreates: Prisma.ColorwayCreateManyInput[] = [];
    const colorwayUpdates: TaggedOp[] = [];
    const variantCreates: Prisma.VariantCreateManyInput[] = [];
    const variantUpdates: TaggedOp[] = [];
    const entryCreates: Prisma.SeasonEntryCreateManyInput[] = [];
    const entryUpdates: TaggedOp[] = [];
    const seasonVariantLinks: Prisma.SeasonVariantCreateManyInput[] = [];
    const priceRows: Array<{
      colorwayId: string;
      currency: string;
      priceType: "MSRP" | "WHOLESALE";
      amount: number;
    }> = [];
    const imageRows: Array<{ colorwayId: string; url: string }> = [];

    for (const s of plan.styles) {
      if (s.wasNew) {
        styleCreates.push({
          id: s.id,
          source: "THREADFLOW",
          threadflowId: s.tf.style_id,
          styleSku: s.tf.style_sku,
          styleName: s.tf.style_name,
          gender: s.tf.gender,
          unisex: s.tf.unisex,
          category: s.tf.category || "Uncategorized",
          brandId,
          hsCode: s.tf.hs_code,
          customsDescription: s.tf.customs_description,
          weightKg: hasValue(s.tf.weight) ? s.tf.weight : null,
          fiberComposition: s.tf.fiber_composition,
        });
      } else {
        styleUpdates.push(
          op(`style ${s.tf.style_sku}`, undefined, () =>
            prisma.style.update({
              where: { id: s.id },
              data: {
                styleSku: s.tf.style_sku,
                styleName: s.tf.style_name,
                gender: s.tf.gender,
                unisex: s.tf.unisex,
                category: s.tf.category || "Uncategorized",
                brandId,
                // don't-clobber-empty for customs
                ...(hasValue(s.tf.hs_code) ? { hsCode: s.tf.hs_code } : {}),
                ...(hasValue(s.tf.customs_description)
                  ? { customsDescription: s.tf.customs_description }
                  : {}),
                ...(hasValue(s.tf.weight) ? { weightKg: s.tf.weight } : {}),
                ...(hasValue(s.tf.fiber_composition)
                  ? { fiberComposition: s.tf.fiber_composition }
                  : {}),
              },
            })
          )
        );
      }
      counts.styles++;
    }

    const entrySeen = new Set<string>();
    for (const p of plan.planned) {
      if (p.skip) {
        counts.skipped++;
        continue;
      }
      buildColorway(p, {
        brandId,
        seasonId,
        manuIdMap: plan.manuIdMap,
        withImages: plan.withImages,
        ownedByColorway: plan.ownedByColorway,
        colorwayCreates,
        colorwayUpdates,
        variantCreates,
        variantUpdates,
        entryCreates,
        entryUpdates,
        seasonVariantLinks,
        priceRows,
        imageRows,
        variantBySku: plan.variantBySku,
        entryIdByColorway: plan.entryIdByColorway,
        entrySeen,
      });
      counts.colorways++;
      counts.variants += p.tf.variants.length;
    }

    // 6. Execute in dependency order. A failure is a named skip, not an abort;
    // a colorway whose own write failed is suppressed from every later phase so
    // nothing is re-pointed at a row that is not there.
    const suppressed = new Set<string>();
    const noteFailures = (fs: OpFailure[], kind: string) => {
      for (const f of fs) {
        if (f.colorwayId) suppressed.add(f.colorwayId);
        warnings.push(`Skipped ${kind} — ${f.label}: ${f.message}`);
      }
    };

    noteFailures(
      await createManyWithFallback(
        styleCreates,
        (data) => prisma.style.createMany({ data }),
        (row) => prisma.style.create({ data: row }),
        (row) => ({ label: `style ${row.styleSku}` })
      ),
      "style"
    );
    noteFailures(await runBatched(styleUpdates), "style");

    noteFailures(
      await createManyWithFallback(
        colorwayCreates,
        (data) => prisma.colorway.createMany({ data }),
        (row) => prisma.colorway.create({ data: row }),
        (row) => ({
          label: `colorway ${row.colorwaySku}`,
          colorwayId: String(row.id),
        })
      ),
      "colorway"
    );
    noteFailures(await runBatched(colorwayUpdates), "colorway");

    const keep = <T extends { colorwayId?: string }>(rows: T[]) =>
      rows.filter((r) => !r.colorwayId || !suppressed.has(r.colorwayId));

    noteFailures(
      await createManyWithFallback(
        keep(variantCreates),
        (data) => prisma.variant.createMany({ data }),
        (row) => prisma.variant.create({ data: row }),
        (row) => ({
          label: `variant ${row.variantSku}`,
          colorwayId: String(row.colorwayId),
        })
      ),
      "variant"
    );
    noteFailures(await runBatched(keep(variantUpdates)), "variant");

    noteFailures(
      await createManyWithFallback(
        keep(entryCreates),
        (data) => prisma.seasonEntry.createMany({ data }),
        (row) => prisma.seasonEntry.create({ data: row }),
        (row) => ({
          label: `season entry ${row.colorwayId}`,
          colorwayId: String(row.colorwayId),
        })
      ),
      "season entry"
    );
    noteFailures(await runBatched(keep(entryUpdates)), "season entry");

    // Season/variant links + prices + images need entry/colorway ids, which now
    // exist. Links: skip duplicates. Prices/images: replace this season's set.
    if (seasonVariantLinks.length) {
      // resolve entry ids for links now that entries are persisted
      const entries = await prisma.seasonEntry.findMany({
        where: { seasonId },
        select: { id: true, colorwayId: true },
      });
      const entryByColorway = new Map(entries.map((e) => [e.colorwayId, e.id]));
      const links = seasonVariantLinks
        .filter((l) => !suppressed.has(l.seasonEntryId))
        .map((l) => ({
          seasonEntryId: entryByColorway.get(l.seasonEntryId) ?? "",
          variantId: l.variantId,
        }))
        .filter((l) => l.seasonEntryId);
      if (links.length)
        await prisma.seasonVariant.createMany({
          data: links,
          skipDuplicates: true,
        });
    }

    // Drop links to variants that no longer belong to the entry's colorway.
    // A SKU rotation moves a variant to a different colorway, and because the
    // link table is only ever added to, the old entry keeps pointing at it —
    // Fuller Chino's SS27 Khaki entry listed 34 sizes, 17 of them Beige's.
    // An entry belongs to exactly one colorway, so a link across colorways is
    // never right and this can only remove wrong rows.
    const staleLinks = await prisma.$executeRaw`
      DELETE FROM "SeasonVariant" sv
       USING "SeasonEntry" se, "Variant" v
       WHERE se.id = sv."seasonEntryId"
         AND v.id = sv."variantId"
         AND se."seasonId" = ${seasonId}
         AND v."colorwayId" <> se."colorwayId"`;
    if (staleLinks)
      warnings.push(
        `Removed ${staleLinks} season size link(s) left pointing at variants that ` +
          `have since moved to another colorway.`
      );

    const priceResult = await syncPrices(
      seasonId,
      priceRows.filter((r) => !suppressed.has(r.colorwayId))
    );
    counts.prices = priceResult.written;
    noteFailures(priceResult.failures, "price");

    if (plan.withImages) {
      const imageResult = await syncImages(
        seasonId,
        imageRows.filter((r) => !suppressed.has(r.colorwayId))
      );
      counts.images = imageResult.written;
      noteFailures(imageResult.failures, "image");
    }

    return finish(
      errors.length ? "failed" : skipped.length ? "partial" : "ok"
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "unknown error");
    return finish("failed");
  }
}

// ---------------------------------------------------------------------------
// Per-colorway op building
// ---------------------------------------------------------------------------

interface ColorwayCtx {
  brandId: string;
  seasonId: string;
  manuIdMap: Map<string, string>;
  withImages: boolean;
  ownedByColorway: Map<string, Set<string>>;
  colorwayCreates: Prisma.ColorwayCreateManyInput[];
  colorwayUpdates: TaggedOp[];
  variantCreates: Prisma.VariantCreateManyInput[];
  variantUpdates: TaggedOp[];
  entryCreates: Prisma.SeasonEntryCreateManyInput[];
  entryUpdates: TaggedOp[];
  seasonVariantLinks: Prisma.SeasonVariantCreateManyInput[];
  priceRows: Array<{
    colorwayId: string;
    currency: string;
    priceType: "MSRP" | "WHOLESALE";
    amount: number;
  }>;
  imageRows: Array<{ colorwayId: string; url: string }>;
  variantBySku: Map<string, { id: string; barcode: string | null }>;
  entryIdByColorway: Map<string, string>;
  entrySeen: Set<string>;
}

function buildColorway(p: PlannedColorway, ctx: ColorwayCtx): void {
  const c = p.tf;
  const colorwayId = p.localId;
  const manufacturerId = c.manufacturer_id
    ? ctx.manuIdMap.get(c.manufacturer_id) ?? null
    : null;

  const base = {
    colorwaySku: c.colorway_sku,
    name: c.name,
    swatchHex: c.swatch?.hex ?? null,
    styleId: p.style.id,
    brandId: ctx.brandId,
    manufacturerId,
    countryOfOrigin: c.country_of_origin,
  };

  if (p.wasNew) {
    ctx.colorwayCreates.push({
      id: colorwayId,
      source: "THREADFLOW",
      threadflowId: c.colorway_id,
      ...base,
      vendor: p.style.vendor,
      productType: p.style.productType,
      // Auto-populate the custom.style_name metafield from the TF style name.
      styleName: p.style.tf.style_name,
    });
  } else {
    // Respect manual edits: only refresh vendor/productType/styleName if not locked.
    const owned = ctx.ownedByColorway.get(colorwayId);
    ctx.colorwayUpdates.push(
      op(`colorway ${c.colorway_sku}`, colorwayId, () =>
        prisma.colorway.update({
          where: { id: colorwayId },
          data: {
            ...base,
            ...(owned?.has("vendor") ? {} : { vendor: p.style.vendor }),
            ...(owned?.has("productType")
              ? {}
              : { productType: p.style.productType }),
            ...(owned?.has("styleName")
              ? {}
              : { styleName: p.style.tf.style_name }),
          },
        })
      )
    );
  }

  // Variants (barcode set-once).
  for (const v of c.variants) {
    const { sizeLabel, dim1, dim2 } = deriveSize(v.dimensions);
    const existing = ctx.variantBySku.get(v.sku);
    if (existing) {
      ctx.variantUpdates.push(
        op(`variant ${v.sku}`, colorwayId, () =>
          prisma.variant.update({
            where: { id: existing.id },
            data: {
              colorwayId,
              sizeLabel,
              dim1,
              dim2,
              ...(hasValue(v.barcode) ? { barcode: v.barcode } : {}),
            },
          })
        )
      );
      ctx.seasonVariantLinks.push({
        seasonEntryId: colorwayId, // placeholder; resolved to entry id later
        variantId: existing.id,
      });
    } else {
      const id = randomUUID();
      ctx.variantBySku.set(v.sku, { id, barcode: v.barcode });
      ctx.variantCreates.push({
        id,
        colorwayId,
        variantSku: v.sku,
        barcode: hasValue(v.barcode) ? v.barcode : null,
        sizeLabel,
        dim1,
        dim2,
      });
      ctx.seasonVariantLinks.push({
        seasonEntryId: colorwayId, // placeholder; resolved later
        variantId: id,
      });
    }
  }

  // Season entry (dropped -> cancelled). One per (colorway, season).
  if (!ctx.entrySeen.has(colorwayId)) {
    ctx.entrySeen.add(colorwayId);
    const existingEntry = ctx.entryIdByColorway.get(colorwayId);
    if (existingEntry) {
      ctx.entryUpdates.push(
        op(`season entry ${c.colorway_sku}`, colorwayId, () =>
          prisma.seasonEntry.update({
            where: { id: existingEntry },
            data: {
              cancelled: c.dropped,
              approvedForProduction: c.approved_for_production,
            },
          })
        )
      );
    } else {
      ctx.entryCreates.push({
        colorwayId,
        seasonId: ctx.seasonId,
        cancelled: c.dropped,
        approvedForProduction: c.approved_for_production,
      });
    }
  }

  // Prices + main image (collected; written in bulk after ids settle).
  for (const [currency, pr] of Object.entries(c.prices ?? {})) {
    if (typeof pr?.msrp === "number")
      ctx.priceRows.push({
        colorwayId,
        currency,
        priceType: "MSRP",
        amount: pr.msrp,
      });
    if (typeof pr?.ws === "number")
      ctx.priceRows.push({
        colorwayId,
        currency,
        priceType: "WHOLESALE",
        amount: pr.ws,
      });
  }
  if (ctx.withImages && hasValue(c.image))
    ctx.imageRows.push({ colorwayId, url: c.image });
}

// ---------------------------------------------------------------------------
// Per-season price/image sets
// ---------------------------------------------------------------------------

async function syncPrices(
  seasonId: string,
  rows: Array<{
    colorwayId: string;
    currency: string;
    priceType: "MSRP" | "WHOLESALE";
    amount: number;
  }>
): Promise<{ written: number; failures: OpFailure[] }> {
  if (!rows.length) return { written: 0, failures: [] };
  const existing = await prisma.price.findMany({
    where: { seasonId },
    select: { id: true, colorwayId: true, currency: true, priceType: true },
  });
  const key = (r: { colorwayId: string; currency: string; priceType: string }) =>
    `${r.colorwayId}|${r.currency}|${r.priceType}`;
  const idByKey = new Map(existing.map((e) => [key(e), e.id]));

  // One row per unique key, last wins — two rows with the same key would both
  // miss `idByKey` and then collide on the unique index.
  const deduped = new Map(rows.map((r) => [key(r), r]));

  const creates: Prisma.PriceCreateManyInput[] = [];
  const updates: TaggedOp[] = [];
  for (const r of deduped.values()) {
    const id = idByKey.get(key(r));
    if (id) {
      updates.push(
        op(`price ${r.currency} ${r.priceType}`, r.colorwayId, () =>
          prisma.price.update({ where: { id }, data: { amount: r.amount } })
        )
      );
    } else {
      creates.push({
        seasonId,
        colorwayId: r.colorwayId,
        currency: r.currency,
        priceType: r.priceType,
        amount: r.amount,
      });
    }
  }
  const failures = [
    ...(await createManyWithFallback(
      creates,
      (data) => prisma.price.createMany({ data }),
      (row) => prisma.price.create({ data: row }),
      (row) => ({
        label: `price ${row.currency} ${row.priceType}`,
        colorwayId: String(row.colorwayId),
      })
    )),
    ...(await runBatched(updates)),
  ];
  return { written: deduped.size - failures.length, failures };
}

async function syncImages(
  seasonId: string,
  rows: Array<{ colorwayId: string; url: string }>
): Promise<{ written: number; failures: OpFailure[] }> {
  if (!rows.length) return { written: 0, failures: [] };
  const existing = await prisma.seasonImage.findMany({
    where: { seasonId, slot: "MAIN" },
    select: { id: true, colorwayId: true },
  });
  const idByColorway = new Map(existing.map((e) => [e.colorwayId, e.id]));
  // One MAIN image per colorway per season.
  const deduped = new Map(rows.map((r) => [r.colorwayId, r]));

  const creates: Prisma.SeasonImageCreateManyInput[] = [];
  const updates: TaggedOp[] = [];
  for (const r of deduped.values()) {
    const id = idByColorway.get(r.colorwayId);
    if (id) {
      updates.push(
        op(`image ${r.colorwayId}`, r.colorwayId, () =>
          prisma.seasonImage.update({ where: { id }, data: { url: r.url } })
        )
      );
    } else {
      creates.push({
        seasonId,
        colorwayId: r.colorwayId,
        slot: "MAIN",
        url: r.url,
      });
    }
  }
  const failures = [
    ...(await createManyWithFallback(
      creates,
      (data) => prisma.seasonImage.createMany({ data }),
      (row) => prisma.seasonImage.create({ data: row }),
      (row) => ({
        label: `image ${row.colorwayId}`,
        colorwayId: String(row.colorwayId),
      })
    )),
    ...(await runBatched(updates)),
  ];
  return { written: deduped.size - failures.length, failures };
}
