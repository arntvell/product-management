import { NextResponse } from "next/server";
import {
  applyStyleSplit,
  previewStyleSplit,
  type ApplyOptions,
  type SelectionRequest,
} from "@/lib/master/style-splits-apply";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/style-splits/apply
//   { selections: [{ targetStyleId, targetRename?, moves: [{ colorwayId, newName? }] }],
//     dryRun?: true, allowThreadflow?, renamePublished? }
//
// Re-points `Colorway.styleId`, which is the only thing Loom groups by. No
// colorway id is written, ever — that is Loom's first constraint, and the dry
// run is what proves it before anything moves.
export async function POST(req: Request) {
  let body: {
    selections?: SelectionRequest[];
    dryRun?: boolean;
  } & ApplyOptions;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const selections = body.selections;
  if (!Array.isArray(selections) || !selections.length) {
    return NextResponse.json({ error: "selections is required" }, { status: 400 });
  }

  const opts: ApplyOptions = {
    allowThreadflow: body.allowThreadflow,
    renamePublished: body.renamePublished,
  };

  try {
    if (body.dryRun !== false) {
      return NextResponse.json({ dryRun: true, ...(await previewStyleSplit(selections, opts)) });
    }

    const started = Date.now();
    const run = await prisma.syncRun.create({
      data: { source: "style-splits", mode: "apply", status: "running" },
    });
    try {
      const result = await applyStyleSplit(selections, opts);
      await prisma.syncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "ok",
          counts: {
            // The styles that now hold the moved colourways. Recorded because a
            // re-nest is only half done until Loom is told: this is what the
            // pending-push queue reads to know what is still owed.
            targetStyleIds: result.styles.map((s) => s.targetStyleId),
            colorwaysMoved: result.colorwaysMoved,
            colorwaysRenamed: result.colorwaysRenamed,
            stylesRenamed: result.stylesRenamed,
            stylesEmptied: result.emptied.length,
            stylesEmptiedInLoom: result.emptied.filter((e) => e.inLoom).length,
          },
          warnings: result.warnings,
        },
      });
      return NextResponse.json({
        dryRun: false,
        syncRunId: run.id,
        durationMs: Date.now() - started,
        ...result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "failed", errors: [message] },
      });
      throw err;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Apply failed" },
      { status: 400 }
    );
  }
}
