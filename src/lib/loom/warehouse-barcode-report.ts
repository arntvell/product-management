// What came in from the warehouse, and what Origio did with it.
//
// The receiver answers Loom in milliseconds and keeps no opinion about what a
// person should do next. This is the other half: the screen that says which
// inbounds arrived, which barcodes were filed, and — the part that matters —
// which rows were NOT filed and why.
//
// This file only reads. The screen it feeds has one action — sending the filed
// barcodes on to the channels — and that goes through warehouse-barcode-sync.ts,
// which hands the work to the same plan/apply pair the variant editor uses.
// Fixing a row that did NOT file still leads back to the editor itself: there is
// one write path to these channels and it keeps one set of guards.

import { prisma } from "@/lib/db";
import type { UnfiledRow } from "./warehouse-barcodes";
import { pendingChannelScope, type ChannelSendSummary } from "./warehouse-barcode-sync";

export interface InboundCounts {
  rows: number;
  filled: number;
  changed: number;
  unchanged: number;
  unfiled: number;
}

export interface AffectedColorway {
  id: string;
  colorwaySku: string;
  name: string;
}

export interface InboundEventRow {
  id: string;
  eventId: string;
  batchId: string;
  inboundRef: string | null;
  poNumber: string | null;
  supplier: string | null;
  revision: number;
  isCorrection: boolean;
  status: string;
  /** True when a newer revision of the same batch has since been processed. */
  stale: boolean;
  counts: InboundCounts;
  unfiled: UnfiledRow[];
  affected: AffectedColorway[];
  receivedAt: Date;
  processedAt: Date | null;
  /** Null while the master holds barcodes the channels do not. */
  channelsPushedAt: Date | null;
  channelReport: ChannelSendSummary | null;
}

export interface InboundSummary {
  events: number;
  inbounds: number;
  /** Unfiled rows on the newest revision of each batch — the real backlog. */
  unfiledNow: number;
  filedAllTime: number;
  /** Sizes whose barcode is in the master but not yet out to the channels. */
  pendingChannels: number;
  /** Colorways those sizes belong to — the unit Loom is pushed in. */
  pendingColorways: number;
}

const ZERO: InboundCounts = { rows: 0, filled: 0, changed: 0, unchanged: 0, unfiled: 0 };

/**
 * The deliveries, newest first.
 *
 * `supplier` is read back out of the stored payload rather than kept in a column
 * of its own: Loom says plainly not to key on it, so it is for a human reading
 * the screen and nothing else.
 */
export async function listInboundEvents(take = 50): Promise<InboundEventRow[]> {
  const rows = await prisma.loomInboundEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take,
  });

  // The newest processed revision per batch, so a superseded row can say so
  // instead of looking like a delivery somebody forgot.
  const newest = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "processed") continue;
    const seen = newest.get(r.batchId);
    if (seen === undefined || r.revision > seen) newest.set(r.batchId, r.revision);
  }

  const colorwayIds = [...new Set(rows.flatMap((r) => (r.affectedColorwayIds as string[] | null) ?? []))];
  const colorways = colorwayIds.length
    ? await prisma.colorway.findMany({
        where: { id: { in: colorwayIds } },
        select: { id: true, colorwaySku: true, name: true },
      })
    : [];
  const byId = new Map(colorways.map((c) => [c.id, c]));

  return rows.map((r) => {
    const payload = r.payload as { data?: { supplier?: string | null } } | null;
    const top = newest.get(r.batchId);
    return {
      id: r.id,
      eventId: r.eventId,
      batchId: r.batchId,
      inboundRef: r.inboundRef,
      poNumber: r.poNumber,
      supplier: payload?.data?.supplier ?? null,
      revision: r.revision,
      isCorrection: r.isCorrection,
      status: r.status,
      stale: r.status === "processed" && top !== undefined && r.revision < top,
      counts: (r.counts as InboundCounts | null) ?? ZERO,
      unfiled: (r.unfiled as UnfiledRow[] | null) ?? [],
      affected: (((r.affectedColorwayIds as string[] | null) ?? [])
        .map((id) => byId.get(id))
        .filter(Boolean) as AffectedColorway[]),
      receivedAt: r.receivedAt,
      processedAt: r.processedAt,
      channelsPushedAt: r.channelsPushedAt,
      channelReport: (r.channelReport as ChannelSendSummary | null) ?? null,
    };
  });
}

/**
 * The figures above the table.
 *
 * `unfiledNow` counts only the newest processed revision of each batch. Counting
 * every event would multiply one inbound's refusals by however many corrections
 * the warehouse made, and report a backlog that was never that big.
 */
export async function inboundSummary(): Promise<InboundSummary> {
  const rows = await prisma.loomInboundEvent.findMany({
    where: { status: "processed" },
    select: { batchId: true, revision: true, counts: true },
    orderBy: { revision: "desc" },
  });

  const top = new Map<string, InboundCounts>();
  let filedAllTime = 0;
  for (const r of rows) {
    const c = (r.counts as InboundCounts | null) ?? ZERO;
    filedAllTime += c.filled + c.changed;
    if (!top.has(r.batchId)) top.set(r.batchId, c); // ordered by revision desc
  }

  // Derived against the master as it is now, not a stored list — see
  // pendingChannelScope for why.
  const pending = await pendingChannelScope();

  return {
    events: await prisma.loomInboundEvent.count(),
    inbounds: top.size,
    unfiledNow: [...top.values()].reduce((a, c) => a + c.unfiled, 0),
    filedAllTime,
    pendingChannels: pending.rows.length,
    pendingColorways: pending.colorwayIds.length,
  };
}
