// Season lifecycle classification (re-runnable). Derives:
//  1. Season.sortOrder   — chronological order parsed from the season code.
//  2. Colorway.isCore     — true when the product carries a CORE/Allseasons tag.
//  3. SeasonEntry.origin  — NEW in a product's earliest season, else CARRYOVER,
//                           using both season membership and season-code tags
//                           (SS26, FW25, SALE_FW24, collection_SS25 …) so we can
//                           detect carry-overs even for seasons we never synced.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// "SS27" -> 20270, "FW26" -> 20265 (SS = first half of year, FW = second).
// Non-season codes (e.g. CONTINUITY) -> null.
export function seasonSortValue(code: string): number | null {
  const m = /^(SS|FW)\s*'?(\d{2})$/i.exec(code.trim());
  if (!m) return null;
  const half = m[1].toUpperCase() === "SS" ? 0 : 5;
  return (2000 + parseInt(m[2], 10)) * 10 + half;
}

// Extract every SS/FW-yy token embedded in a tag ("SALE_FW25" -> FW25=20255,
// "collection_SS25" -> 20250), returning their sort values.
function seasonValuesInTag(tag: string): number[] {
  const out: number[] = [];
  const re = /(SS|FW)\s*'?(\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const half = m[1].toUpperCase() === "SS" ? 0 : 5;
    out.push((2000 + parseInt(m[2], 10)) * 10 + half);
  }
  return out;
}

function isCoreTags(tags: string[]): boolean {
  return tags.some((t) => t.trim().toUpperCase() === "CORE" || /allseason/i.test(t));
}

export interface ClassifyPreview {
  seasonsOrdered: { code: string; sortOrder: number }[];
  colorways: number;
  coreCount: number;
  entriesNew: number;
  entriesCarryover: number;
}

async function computePlan() {
  const seasons = await prisma.season.findMany({ select: { id: true, code: true } });
  const seasonValueById = new Map<string, number | null>();
  for (const s of seasons) seasonValueById.set(s.id, seasonSortValue(s.code));

  // Manual overrides (from the Collections editor) must never be reverted.
  const locks = await prisma.fieldOwner.findMany({
    where: { owner: "MANUAL", field: { in: ["isCore", "origin"] } },
    select: { entityType: true, entityId: true, field: true },
  });
  const coreLocked = new Set<string>(); // colorway ids
  const originLocked = new Set<string>(); // season-entry ids
  for (const l of locks) {
    if (l.field === "isCore" && l.entityType === "colorway") coreLocked.add(l.entityId);
    if (l.field === "origin" && l.entityType === "seasonEntry") originLocked.add(l.entityId);
  }

  const colorways = await prisma.colorway.findMany({
    select: {
      id: true,
      isCore: true,
      tags: true,
      entries: { select: { id: true, seasonId: true, origin: true } },
    },
  });

  const coreTrue: string[] = [];
  const coreFalse: string[] = [];
  const entriesToNew: string[] = [];
  const entriesToCarry: string[] = [];

  for (const cw of colorways) {
    // CORE from tags — unless manually overridden.
    if (!coreLocked.has(cw.id)) {
      const core = isCoreTags(cw.tags);
      if (core && !cw.isCore) coreTrue.push(cw.id);
      else if (!core && cw.isCore) coreFalse.push(cw.id);
    }

    // Origin value = earliest real-season signal from entries + tags.
    const candidates: number[] = [];
    for (const e of cw.entries) {
      const v = seasonValueById.get(e.seasonId);
      if (v != null) candidates.push(v);
    }
    for (const t of cw.tags) candidates.push(...seasonValuesInTag(t));
    const origin = candidates.length ? Math.min(...candidates) : null;

    for (const e of cw.entries) {
      const sv = seasonValueById.get(e.seasonId);
      // Only classify real (SS/FW) seasons; leave CONTINUITY entries as-is.
      if (sv == null) continue;
      if (originLocked.has(e.id)) continue; // manual override
      const desired = origin != null && sv > origin ? "CARRYOVER" : "NEW";
      if (desired !== e.origin) (desired === "CARRYOVER" ? entriesToCarry : entriesToNew).push(e.id);
    }
  }

  return {
    seasons,
    seasonValueById,
    coreTrue,
    coreFalse,
    entriesToNew,
    entriesToCarry,
    colorwayCount: colorways.length,
    coreTotal: colorways.filter((c) => isCoreTags(c.tags)).length,
    newTotal: 0,
    carryTotal: 0,
  };
}

export async function previewClassify(): Promise<ClassifyPreview> {
  const plan = await computePlan();
  // Count post-state per entry by re-deriving totals cheaply.
  const entries = await prisma.seasonEntry.findMany({
    select: { seasonId: true, origin: true, id: true },
  });
  const toCarry = new Set(plan.entriesToCarry);
  const toNew = new Set(plan.entriesToNew);
  let entriesNew = 0, entriesCarryover = 0;
  for (const e of entries) {
    const sv = plan.seasonValueById.get(e.seasonId);
    if (sv == null) continue;
    const final = toCarry.has(e.id) ? "CARRYOVER" : toNew.has(e.id) ? "NEW" : e.origin;
    if (final === "CARRYOVER") entriesCarryover++;
    else entriesNew++;
  }
  return {
    seasonsOrdered: plan.seasons
      .map((s) => ({ code: s.code, sortOrder: seasonSortValue(s.code) ?? 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    colorways: plan.colorwayCount,
    coreCount: plan.coreTotal,
    entriesNew,
    entriesCarryover,
  };
}

export interface ClassifyResult {
  seasonsUpdated: number;
  coreSet: number;
  coreCleared: number;
  entriesCarryover: number;
  entriesNew: number;
  syncRunId: string;
}

export async function runClassify(): Promise<ClassifyResult> {
  const run = await prisma.syncRun.create({
    data: { source: "classify", mode: "season-lifecycle", status: "running" },
  });
  try {
    // 1. Season.sortOrder from code.
    const seasons = await prisma.season.findMany({ select: { id: true, code: true } });
    let seasonsUpdated = 0;
    for (const s of seasons) {
      const sv = seasonSortValue(s.code) ?? 0;
      await prisma.season.update({ where: { id: s.id }, data: { sortOrder: sv } });
      seasonsUpdated++;
    }

    const plan = await computePlan();

    const chunk = async (ids: string[], data: Prisma.ColorwayUpdateManyMutationInput) => {
      for (let i = 0; i < ids.length; i += 500)
        await prisma.colorway.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data });
    };
    await chunk(plan.coreTrue, { isCore: true });
    await chunk(plan.coreFalse, { isCore: false });

    const chunkEntries = async (ids: string[], origin: "NEW" | "CARRYOVER") => {
      for (let i = 0; i < ids.length; i += 500)
        await prisma.seasonEntry.updateMany({ where: { id: { in: ids.slice(i, i + 500) } }, data: { origin } });
    };
    await chunkEntries(plan.entriesToCarry, "CARRYOVER");
    await chunkEntries(plan.entriesToNew, "NEW");

    const result: ClassifyResult = {
      seasonsUpdated,
      coreSet: plan.coreTrue.length,
      coreCleared: plan.coreFalse.length,
      entriesCarryover: plan.entriesToCarry.length,
      entriesNew: plan.entriesToNew.length,
      syncRunId: run.id,
    };
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "ok", counts: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        errors: [err instanceof Error ? err.message : "unknown"] as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
