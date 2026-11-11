// Threadflow drop status: which products are cancelled, and which approved.
//
// The season sync carries `dropped` and `approved_for_production` onto the
// SeasonEntry, but only when someone runs it — and it rewrites everything else
// too, so nobody runs it to catch a cancellation. This is the narrow version:
// read the season from Threadflow, and change only those two flags.
//
// Run by Threadflow's webhook (/api/threadflow/webhook) when a style changes,
// and nightly (/api/cron/threadflow-drops) as the backstop for a delivery that
// never arrived. The webhook is a TRIGGER, not a source: whatever it says, the
// figures come from Threadflow's read API, so a stale or out-of-order event
// cannot set a wrong flag.
//
// Each run is a SyncRun row (source "threadflow", mode "drop-status") with the
// changes in `warnings`, so /api/catalog/sync's history shows them.
import { prisma } from "@/lib/db";
import { getSeasonProducts } from "./client";

export interface DropChange {
  sku: string;
  name: string;
  season: string;
  field: "cancelled" | "approvedForProduction";
  from: boolean;
  to: boolean;
  /** Dropped and still on Shopify: the case a person has to act on. */
  liveOnShopify: boolean;
}

export interface DropStatusRun {
  season: string;
  checked: number;
  /** Threadflow colourways with no Origo row for this season — not synced yet. */
  unmatched: number;
  changes: DropChange[];
  syncRunId: string | null;
}

/** Threadflow's view of one season, written onto Origo's season entries. */
export async function refreshDropStatus(
  seasonCode: string,
  opts: { dryRun?: boolean; trigger?: string } = {}
): Promise<DropStatusRun> {
  const season = await prisma.season.findUnique({ where: { code: seasonCode }, select: { id: true, code: true } });
  if (!season) throw new Error(`No season ${seasonCode} in Origo`);
  const run = opts.dryRun
    ? null
    : await prisma.syncRun.create({
        data: { source: "threadflow", mode: "drop-status", seasonCode, status: "running" },
        select: { id: true },
      });

  try {
    const { styles } = await getSeasonProducts(seasonCode, { includeDropped: true, includeUnapproved: true });
    const tf = styles.flatMap((s) => s.colorways);

    const entries = await prisma.seasonEntry.findMany({
      where: { seasonId: season.id },
      select: {
        id: true,
        cancelled: true,
        approvedForProduction: true,
        colorway: {
          select: {
            colorwaySku: true,
            threadflowId: true,
            name: true,
            style: { select: { styleName: true } },
            publications: { where: { channel: "SHOPIFY", published: true }, select: { externalId: true } },
          },
        },
      },
    });
    const byTfId = new Map(entries.filter((e) => e.colorway.threadflowId).map((e) => [e.colorway.threadflowId!, e]));
    const bySku = new Map(entries.map((e) => [e.colorway.colorwaySku.toUpperCase(), e]));

    const changes: DropChange[] = [];
    const writes: ReturnType<typeof prisma.seasonEntry.update>[] = [];
    let unmatched = 0;
    for (const c of tf) {
      const e = byTfId.get(c.colorway_id) ?? bySku.get(c.colorway_sku.toUpperCase());
      if (!e) {
        unmatched++;
        continue;
      }
      const cw = e.colorway;
      const name = cw.name.startsWith(cw.style.styleName) ? cw.name : `${cw.style.styleName} ${cw.name}`;
      const live = cw.publications.some((p) => p.externalId);
      const data: { cancelled?: boolean; approvedForProduction?: boolean } = {};
      if (e.cancelled !== c.dropped) {
        data.cancelled = c.dropped;
        changes.push({ sku: cw.colorwaySku, name, season: seasonCode, field: "cancelled", from: e.cancelled, to: c.dropped, liveOnShopify: c.dropped && live });
      }
      if (e.approvedForProduction !== c.approved_for_production) {
        data.approvedForProduction = c.approved_for_production;
        changes.push({ sku: cw.colorwaySku, name, season: seasonCode, field: "approvedForProduction", from: e.approvedForProduction, to: c.approved_for_production, liveOnShopify: false });
      }
      if (Object.keys(data).length) writes.push(prisma.seasonEntry.update({ where: { id: e.id }, data }));
    }
    if (!opts.dryRun && writes.length) await prisma.$transaction(writes);

    if (run)
      await prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: "ok",
          finishedAt: new Date(),
          counts: { checked: tf.length, unmatched, changed: changes.length, trigger: opts.trigger ?? null },
          warnings: changes.map(describeChange),
        },
      });
    return { season: seasonCode, checked: tf.length, unmatched, changes, syncRunId: run?.id ?? null };
  } catch (err) {
    if (run)
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), errors: [err instanceof Error ? err.message : String(err)] },
      });
    throw err;
  }
}

/** Seasons Threadflow plans: the regular ones it has an id for. */
export async function threadflowSeasons(): Promise<string[]> {
  const seasons = await prisma.season.findMany({
    where: { kind: "REGULAR", threadflowId: { not: null } },
    select: { code: true },
  });
  return seasons.map((s) => s.code);
}

export function describeChange(c: DropChange): string {
  const what =
    c.field === "cancelled"
      ? c.to
        ? "dropped in Threadflow"
        : "restored in Threadflow"
      : c.to
        ? "approved for production"
        : "no longer approved for production";
  return `${c.season} ${c.name} (${c.sku}): ${what}${c.liveOnShopify ? " — still on Shopify" : ""}`;
}
