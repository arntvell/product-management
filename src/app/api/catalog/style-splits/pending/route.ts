import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/catalog/style-splits/pending
//
// Styles re-nested here but not yet sent to Loom.
//
// This is the gap that makes a half-finished repair dangerous rather than
// merely incomplete: once the colourways move, the proposal disappears from the
// report — there is nothing left to notice — while Loom still holds the old
// grouping. So each apply records which styles it touched, and this compares
// that against every colourway's `lastPushedAt` for the LOOM channel.
//
// A style is settled when all its colourways carry a LOOM publication stamped
// at or after the apply. Anything else is still owed.
export async function GET() {
  const runs = await prisma.syncRun.findMany({
    where: { source: "style-splits", mode: "apply", status: "ok" },
    orderBy: { startedAt: "desc" },
    take: 200,
    select: { id: true, startedAt: true, finishedAt: true, counts: true },
  });

  // Earliest apply per style — that is the moment Loom's copy went stale.
  const appliedAt = new Map<string, Date>();
  const runIdByStyle = new Map<string, string>();
  let unrecorded = 0;
  for (const run of runs) {
    const ids = (run.counts as { targetStyleIds?: string[] } | null)?.targetStyleIds;
    // Applies from before the id was recorded — recover them from the clock.
    // The colourway writes happen between startedAt and finishedAt, and the
    // only thing running in that window was this apply, so the styles now
    // holding those rows are the targets. Reconstructed rather than dropped,
    // because a change Loom has not been told about is exactly what this
    // endpoint exists to surface.
    if (!ids) {
      unrecorded++;
      const end = run.finishedAt ?? run.startedAt;
      const touched = await prisma.colorway.findMany({
        where: { updatedAt: { gte: run.startedAt, lte: new Date(end.getTime() + 2000) } },
        select: { styleId: true },
        distinct: ["styleId"],
      });
      for (const t of touched) {
        const seen = appliedAt.get(t.styleId);
        if (!seen || end < seen) {
          appliedAt.set(t.styleId, end);
          runIdByStyle.set(t.styleId, run.id);
        }
      }
      continue;
    }
    for (const id of ids) {
      const at = run.finishedAt ?? run.startedAt;
      const seen = appliedAt.get(id);
      if (!seen || at < seen) {
        appliedAt.set(id, at);
        runIdByStyle.set(id, run.id);
      }
    }
  }

  const styles = appliedAt.size
    ? await prisma.style.findMany({
        where: { id: { in: [...appliedAt.keys()] } },
        select: {
          id: true,
          styleSku: true,
          styleName: true,
          colorways: {
            select: {
              id: true,
              colorwaySku: true,
              entries: { select: { season: { select: { code: true } } } },
              publications: {
                where: { channel: "LOOM" },
                select: { lastPushedAt: true, lastPushStatus: true },
              },
            },
          },
        },
      })
    : [];

  const pending = [];
  const settled = [];
  for (const s of styles) {
    const at = appliedAt.get(s.id)!;
    const stale = s.colorways.filter((c) => {
      const pushedAt = c.publications[0]?.lastPushedAt;
      return !pushedAt || pushedAt < at;
    });
    const row = {
      styleId: s.id,
      styleSku: s.styleSku,
      styleName: s.styleName,
      appliedAt: at.toISOString(),
      syncRunId: runIdByStyle.get(s.id),
      colorways: s.colorways.length,
      notPushed: stale.length,
      seasons: [
        ...new Set(s.colorways.flatMap((c) => c.entries.map((e) => e.season.code))),
      ].sort(),
      examples: stale.slice(0, 4).map((c) => c.colorwaySku),
    };
    if (stale.length) pending.push(row);
    else settled.push(row);
  }

  pending.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
  return NextResponse.json({ pending, settled, unrecordedRuns: unrecorded });
}
