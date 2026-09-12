// Removing colorways an interrupted import left behind.
//
// A failed bulk import can commit its colorways and die before its variants:
// Variant.barcode is uniquely indexed, so a single duplicate in the batch fails
// the whole createMany. What survives is a colorway with no variants — inert,
// but it pollutes Collections and every count, and it blocks a re-run because
// the importer treats the SKU as already present.
//
// Deliberately narrow. It only removes colorways that have NO variants and NO
// dependent rows of any kind, and it verifies that again inside the transaction
// rather than trusting the preview.

import { prisma } from "@/lib/db";

export interface OrphanPlan {
  colorways: Array<{ id: string; colorwaySku: string; createdAt: Date }>;
  styles: number;
  /** Anything found attached — a non-zero value here stops the delete. */
  dependents: { entries: number; prices: number; media: number; publications: number };
}

export interface OrphanResult {
  deletedColorways: number;
  deletedStyles: number;
  dryRun: boolean;
  refused: string | null;
}

/** @param since only consider records created at or after this instant. */
export async function planOrphanCleanup(since: Date): Promise<OrphanPlan> {
  const colorways = await prisma.colorway.findMany({
    where: { createdAt: { gte: since }, variants: { none: {} } },
    select: { id: true, colorwaySku: true, createdAt: true },
    orderBy: { colorwaySku: "asc" },
  });
  const ids = colorways.map((c) => c.id);

  const [entries, prices, media, publications, styles] = await Promise.all([
    prisma.seasonEntry.count({ where: { colorwayId: { in: ids } } }),
    prisma.price.count({ where: { colorwayId: { in: ids } } }),
    prisma.mediaAsset.count({ where: { colorwayId: { in: ids } } }),
    prisma.channelPublication.count({ where: { colorwayId: { in: ids } } }),
    prisma.style.count({
      where: { createdAt: { gte: since }, colorways: { every: { variants: { none: {} } } } },
    }),
  ]);

  return { colorways, styles, dependents: { entries, prices, media, publications } };
}

export async function cleanupOrphans(
  since: Date,
  opts: { dryRun?: boolean } = {}
): Promise<OrphanResult & { plan: OrphanPlan }> {
  const plan = await planOrphanCleanup(since);
  const d = plan.dependents;
  const attached = d.entries + d.prices + d.media + d.publications;

  if (attached > 0) {
    return {
      plan,
      deletedColorways: 0,
      deletedStyles: 0,
      dryRun: Boolean(opts.dryRun),
      refused: `${attached} dependent rows are attached — these are not orphans`,
    };
  }
  if (opts.dryRun) {
    return { plan, deletedColorways: 0, deletedStyles: 0, dryRun: true, refused: null };
  }

  const ids = plan.colorways.map((c) => c.id);
  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction. The preview is a moment in time and this
    // is a delete; a variant created in between must stop it.
    const stillOrphan = await tx.colorway.count({
      where: { id: { in: ids }, variants: { none: {} } },
    });
    if (stillOrphan !== ids.length) {
      throw new Error(
        `refusing: ${ids.length - stillOrphan} of ${ids.length} gained variants since the preview`
      );
    }
    const cw = await tx.colorway.deleteMany({ where: { id: { in: ids } } });
    const st = await tx.style.deleteMany({
      where: { createdAt: { gte: since }, colorways: { none: {} } },
    });
    return { cw: cw.count, st: st.count };
  });

  return {
    plan,
    deletedColorways: result.cw,
    deletedStyles: result.st,
    dryRun: false,
    refused: null,
  };
}
