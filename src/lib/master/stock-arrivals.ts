// Stock arrivals: tell Admins and Product managers when a product that has
// never had stock gets some.
//
// Loom sends no "goods received" event — `barcodes.ready` only fires for
// deliveries carrying sizes without a barcode — but it does report on-hand per
// location on request. So this READS on a schedule (twice a day, vercel.json)
// and compares with the previous read, kept in StockWatch:
//
//   no StockWatch row yet          the baseline: record it, never alert. The
//                                  first run therefore says nothing.
//   receivedAt null, was 0, now >0 ARRIVED: one line in this run's alert.
//   receivedAt set                 already arrived once; a restock after a
//                                  sell-out is not an arrival.
//   absent from Loom               skipped, not read as 0 — a product Loom
//                                  does not hold has not "had none".
//
// Scope: every Livid merchandise product in a REGULAR season, cancelled season
// entries aside. Other brands are left out for now; to watch one, widen
// WATCHED_BRANDS. Continuity (vintage, resold brands) is out: it is bought in
// already in stock.
import { prisma } from "@/lib/db";
import { loomStockFor, type LoomStock } from "@/lib/loom/stock";
import type { Prisma } from "@/generated/prisma/client";

export interface StockArrival {
  colorwayId: string;
  sku: string;
  styleName: string;
  name: string;
  brand: string;
  season: string;
  onHand: number;
  warehouse: number;
  stores: number;
  locations: { location: string; onHand: number }[];
}

export interface StockArrivalRun {
  checked: number;
  baselined: number;
  notInLoom: number;
  arrivals: StockArrival[];
  alertId: string | null;
  recipients: number;
  dryRun: boolean;
}

/** Which brands are watched. Livid only for now. */
const WATCHED_BRANDS: Prisma.BrandWhereInput = { isLivid: true };

/** A Loom read for every candidate, season by season. Throws if Loom does. */
async function readCandidates() {
  const entries = await prisma.seasonEntry.findMany({
    where: {
      season: { kind: "REGULAR" },
      cancelled: false,
      OR: [{ drop: null }, { drop: { not: "CANCELED" } }],
      colorway: { archived: false, kind: "MERCHANDISE", brand: WATCHED_BRANDS },
    },
    select: {
      season: { select: { code: true } },
      colorway: {
        select: {
          id: true,
          colorwaySku: true,
          name: true,
          vendor: true,
          brand: { select: { name: true } },
          style: { select: { styleName: true } },
        },
      },
    },
  });

  // A product in two seasons is read under each but watched once; the first
  // season it was read under is the one the alert names.
  const bySeason = new Map<string, (typeof entries)[number]["colorway"][]>();
  for (const e of entries) {
    const list = bySeason.get(e.season.code) ?? [];
    list.push(e.colorway);
    bySeason.set(e.season.code, list);
  }
  const read = new Map<string, { cw: (typeof entries)[number]["colorway"]; season: string; stock: LoomStock }>();
  const seen = new Set<string>();
  for (const [season, cws] of bySeason) {
    const stock = await loomStockFor(
      season,
      cws.map((c) => ({ id: c.id, sku: c.colorwaySku }))
    );
    for (const cw of cws) {
      seen.add(cw.id);
      const s = stock.get(cw.id);
      if (s && !read.has(cw.id)) read.set(cw.id, { cw, season, stock: s });
    }
  }
  return { read, candidates: seen.size };
}

export async function runStockArrivals(opts: { dryRun?: boolean } = {}): Promise<StockArrivalRun> {
  const dryRun = !!opts.dryRun;
  // Loom first: if it cannot be read, nothing below is written.
  const { read, candidates } = await readCandidates();

  const watches = await prisma.stockWatch.findMany({
    where: { colorwayId: { in: [...read.keys()] } },
  });
  const watchById = new Map(watches.map((w) => [w.colorwayId, w]));

  const now = new Date();
  const arrivals: StockArrival[] = [];
  let baselined = 0;
  const writes: Prisma.PrismaPromise<unknown>[] = [];

  for (const [id, { cw, season, stock }] of read) {
    const prev = watchById.get(id);
    const onHand = stock.total;
    if (!prev) {
      baselined++;
      writes.push(
        prisma.stockWatch.create({
          data: { colorwayId: id, onHand, checkedAt: now, receivedAt: onHand > 0 ? now : null },
        })
      );
      continue;
    }
    const arrived = !prev.receivedAt && prev.onHand <= 0 && onHand > 0;
    if (arrived)
      arrivals.push({
        colorwayId: id,
        sku: cw.colorwaySku,
        styleName: cw.style.styleName,
        name: cw.name,
        brand: cw.brand?.name ?? cw.vendor ?? "",
        season,
        onHand,
        warehouse: stock.warehouse,
        stores: stock.stores,
        locations: stock.byLocation,
      });
    writes.push(
      prisma.stockWatch.update({
        where: { colorwayId: id },
        data: { onHand, checkedAt: now, ...(arrived ? { receivedAt: now } : {}) },
      })
    );
  }

  arrivals.sort((a, b) => a.brand.localeCompare(b.brand) || a.styleName.localeCompare(b.styleName) || a.name.localeCompare(b.name));

  const recipients = await prisma.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "PRODUCT_MANAGER"] } },
    select: { id: true },
  });

  if (dryRun)
    return {
      checked: candidates,
      baselined,
      notInLoom: candidates - read.size,
      arrivals,
      alertId: null,
      recipients: recipients.length,
      dryRun,
    };

  // The alert first, then the watch rows. If the watch writes fail, the next
  // run sees the same arrivals and alerts again: a repeat, which is better than
  // marking a product received with no alert to say so.
  let alertId: string | null = null;
  if (arrivals.length)
    alertId = (
      await prisma.stockAlert.create({
        data: {
          arrivals: arrivals as unknown as Prisma.InputJsonValue,
          receipts: { create: recipients.map((u) => ({ userId: u.id })) },
        },
        select: { id: true },
      })
    ).id;
  // Batched so a season's worth of updates is a handful of round trips.
  for (let i = 0; i < writes.length; i += 200) await prisma.$transaction(writes.slice(i, i + 200));

  return {
    checked: candidates,
    baselined,
    notInLoom: candidates - read.size,
    arrivals,
    alertId,
    recipients: recipients.length,
    dryRun,
  };
}

/** Alerts the user has not seen yet, oldest first. */
export async function unseenStockAlerts(userId: string) {
  const receipts = await prisma.stockAlertReceipt.findMany({
    where: { userId, seenAt: null },
    orderBy: { alert: { createdAt: "asc" } },
    select: { alert: { select: { id: true, createdAt: true, arrivals: true } } },
  });
  return receipts.map((r) => ({
    id: r.alert.id,
    createdAt: r.alert.createdAt.toISOString(),
    arrivals: r.alert.arrivals as unknown as StockArrival[],
  }));
}

export async function markStockAlertsSeen(userId: string, alertIds: string[]) {
  const r = await prisma.stockAlertReceipt.updateMany({
    where: { userId, alertId: { in: alertIds }, seenAt: null },
    data: { seenAt: new Date() },
  });
  return r.count;
}
