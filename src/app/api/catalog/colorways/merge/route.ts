import { NextResponse } from "next/server";
import {
  applyColorwayMerge,
  previewColorwayMerge,
  type MergeOptions,
} from "@/lib/master/merge-colorways";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/colorways/merge
//   { keepId, loseId, dryRun?: true, confirm?: true,
//     allowPublishedLoser?, allowDifferentStyle?, deleteLoserVariants? }
//
// The survivor is `keepId` — by convention the row that already holds the SKU
// Threadflow wants, which is also the row the channels are publishing. Preview
// first: this is the one pass in the catalog that retires a row.
export async function POST(req: Request) {
  let body: {
    keepId?: string;
    loseId?: string;
    dryRun?: boolean;
  } & MergeOptions;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keepId = body.keepId?.trim();
  const loseId = body.loseId?.trim();
  if (!keepId || !loseId) {
    return NextResponse.json(
      { error: "keepId and loseId are required" },
      { status: 400 }
    );
  }

  const opts: MergeOptions = {
    confirm: body.confirm,
    allowPublishedLoser: body.allowPublishedLoser,
    allowDifferentStyle: body.allowDifferentStyle,
    deleteLoserVariants: body.deleteLoserVariants,
  };

  try {
    if (body.dryRun !== false) {
      const plan = await previewColorwayMerge(keepId, loseId, opts);
      return NextResponse.json({ dryRun: true, ...plan });
    }

    const started = Date.now();
    const run = await prisma.syncRun.create({
      data: {
        source: "merge-colorways",
        mode: "apply",
        status: "running",
      },
    });
    try {
      const result = await applyColorwayMerge(keepId, loseId, opts);
      await prisma.syncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: "ok",
          counts: {
            variantsMoved: result.variantsMoved,
            variantsFolded: result.variantsFolded,
            barcodesCarried: result.barcodesCarried,
            entries: result.entries.length,
          },
          warnings: result.notes,
        },
      });
      return NextResponse.json({
        dryRun: false,
        syncRunId: run.id,
        durationMs: Date.now() - started,
        ...result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Merge failed";
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: "failed", errors: [message] },
      });
      throw err;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed" },
      { status: 400 }
    );
  }
}
