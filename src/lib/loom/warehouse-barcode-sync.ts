// Carrying warehouse barcodes out to the channels.
//
// The receiver files a barcode in the master and answers Loom inside its 15 s
// budget. Shopify and Sitoo do not fit in that budget, so this is the step that
// closes the gap — and since a delivery arriving is not a decision anybody
// needs to take, it runs on its own straight after the reply (see the receiver's
// `after()` call). The screen keeps a Send button for whatever a run could not
// finish: a Sitoo outage is retried by a person, not re-attempted forever.
//
// LOOM IS NOT A TARGET HERE, and that is the point. The barcode came FROM Loom:
// the warehouse typed it in there while receiving. The handover asks only that
// "your feed next sends that size with the same barcode" — the normal feed
// cadence, which now carries it — and §4 only cares about the case where Origio
// sends a DIFFERENT barcode. Pushing Loom the value it just gave us is a round
// trip that changes nothing, so `skipLoom` keeps it out of the scope read too.
//
// Nothing here writes a channel itself. It works out WHAT should be sent and
// hands it to `variant-barcodes.ts`, which is the path the variant editor
// already uses — master first, then every Shopify variant and Sitoo product the
// garment is linked to, with the guards those modules carry (check digit, one
// code per garment, rotations, wrong-product ids). A second route to the same
// channels would be a second set of guards to keep right.
//
// The master write is a no-op by design. The barcodes passed in are the ones the
// master already holds, so every row plans as `unchanged` — which `ACCEPTED`
// includes, so the rows still flow out to the channels. That matters for
// attribution: `applyBarcodeCorrections` records a decision only for rows it
// actually writes, so an unchanged row leaves `FieldOwner.authority` saying
// `loom:warehouse-scan` rather than overwriting it with the editor's. There is
// an assertion on that in scripts/check-warehouse-barcodes.ts, because it is
// load-bearing and invisible.

import { prisma } from "@/lib/db";
import { barcodeKey } from "@/lib/master/barcode";
import {
  applyVariantBarcodeEdits,
  planVariantBarcodeEdits,
  type VariantBarcodeEdit,
  type VariantBarcodeReport,
} from "@/lib/master/variant-barcodes";
import type { LoomBarcodeRow, BarcodesReadyPayload } from "./warehouse-barcodes";

export interface PendingRow {
  eventId: string;
  inboundRef: string | null;
  variantId: string;
  variantSku: string;
  colorwayId: string;
  barcode: string;
}

export interface PendingScope {
  rows: PendingRow[];
  /** Event ids the rows came from — what gets marked sent afterwards. */
  eventIds: string[];
  /** Distinct colorways the pending sizes belong to, for the screen's count. */
  colorwayIds: string[];
}

/**
 * The barcodes the master holds and the channels may not.
 *
 * Derived from the stored payload against the master as it is NOW, rather than
 * read from a list written at receipt. Two reasons. A row the warehouse sent is
 * only worth pushing if the master actually ended up holding it — a row refused
 * as a collision, or later changed by hand in the editor, must not be pushed
 * from a stale record of what Loom once said. And a correction that supersedes an
 * earlier revision would otherwise leave both spellings queued.
 *
 * `processed` events only, newest revision per batch only, and the comparison is
 * by `barcodeKey` — Loom sends the digits the warehouse typed, the master holds
 * `storedForm`, and `00884597234150`, `0884597234150` and `884597234150` are one
 * barcode.
 */
export async function pendingChannelScope(eventId?: string): Promise<PendingScope> {
  const events = await prisma.loomInboundEvent.findMany({
    where: {
      status: "processed",
      channelsPushedAt: null,
      ...(eventId ? { eventId } : {}),
    },
    orderBy: { revision: "desc" },
  });

  // A superseded revision's rows are either refiled by the newer event or were
  // deliberately refused; either way the newer event is the one to push.
  const newestPerBatch = new Map<string, string>();
  for (const e of events) if (!newestPerBatch.has(e.batchId)) newestPerBatch.set(e.batchId, e.eventId);
  const live = events.filter((e) => newestPerBatch.get(e.batchId) === e.eventId);

  const wanted: Array<{ eventId: string; inboundRef: string | null; row: LoomBarcodeRow }> = [];
  for (const e of live) {
    const payload = e.payload as unknown as BarcodesReadyPayload | null;
    for (const row of payload?.data?.barcodes ?? []) {
      wanted.push({ eventId: e.eventId, inboundRef: e.inboundRef, row });
    }
  }
  if (!wanted.length) return { rows: [], eventIds: [], colorwayIds: [] };

  // Resolve exactly as the receiver did: the id it gave us, then Loom's own
  // spelling on the LOOM channel, then the master's SKU.
  const ids = wanted.map((w) => w.row.origio_variant_id).filter((x): x is string => !!x);
  const skus = wanted.map((w) => w.row.sku);
  const [byId, aliases, bySku] = await Promise.all([
    ids.length
      ? prisma.variant.findMany({
          where: { id: { in: ids } },
          select: { id: true, variantSku: true, colorwayId: true, barcode: true },
        })
      : Promise.resolve([]),
    prisma.variantChannelRef.findMany({
      where: { channel: "LOOM", externalSku: { in: skus } },
      select: {
        externalSku: true,
        variant: { select: { id: true, variantSku: true, colorwayId: true, barcode: true } },
      },
    }),
    prisma.variant.findMany({
      where: { variantSku: { in: skus } },
      select: { id: true, variantSku: true, colorwayId: true, barcode: true },
    }),
  ]);
  const idMap = new Map(byId.map((v) => [v.id, v]));
  const aliasMap = new Map(aliases.filter((a) => a.externalSku).map((a) => [a.externalSku!, a.variant]));
  const skuMap = new Map(bySku.map((v) => [v.variantSku, v]));

  const rows: PendingRow[] = [];
  const seen = new Set<string>();
  const eventIds = new Set<string>();
  for (const w of wanted) {
    const v =
      (w.row.origio_variant_id ? idMap.get(w.row.origio_variant_id) : undefined) ??
      aliasMap.get(w.row.sku) ??
      skuMap.get(w.row.sku);
    if (!v) continue;
    // The master must actually hold what Loom sent. Anything else was refused at
    // receipt or has since been decided differently, and is not ours to push.
    if (!v.barcode || barcodeKey(v.barcode) !== barcodeKey(w.row.barcode)) continue;
    eventIds.add(w.eventId);
    if (seen.has(v.id)) continue; // one row per size, even across revisions
    seen.add(v.id);
    rows.push({
      eventId: w.eventId,
      inboundRef: w.inboundRef,
      variantId: v.id,
      variantSku: v.variantSku,
      colorwayId: v.colorwayId,
      // The master's own spelling, which is what the channels are brought into
      // line with — not the digits Loom happened to send.
      barcode: v.barcode,
    });
  }

  return {
    rows,
    eventIds: [...eventIds],
    colorwayIds: [...new Set(rows.map((r) => r.colorwayId))],
  };
}

export interface SyncResult {
  scope: PendingScope;
  report: VariantBarcodeReport;
  /** Set on an apply: what was recorded against the events. */
  summary?: ChannelSendSummary;
  /** True when something failed, so the rows stay pending. */
  stillPending?: boolean;
}

/**
 * Preview or carry out the send.
 *
 * A preview reads Shopify and Sitoo and changes nothing. An apply writes the
 * master (a no-op — see the note at the top), then Shopify and Sitoo, and
 * records the outcome against the events itself. One call, because with Loom out
 * of the picture there is no job that can outlast the request — that was the
 * only reason the editor hands its Loom step back to the caller.
 */
export async function syncWarehouseBarcodes(
  opts: { eventId?: string; dryRun: boolean } = { dryRun: true }
): Promise<SyncResult> {
  const scope = await pendingChannelScope(opts.eventId);
  if (!scope.rows.length) {
    return {
      scope,
      report: {
        dryRun: opts.dryRun,
        rows: [],
        loomGroups: [],
        channelErrors: {},
        master: { applied: 0, ledgerRecorded: 0 },
        unwound: [],
      },
    };
  }

  const edits: VariantBarcodeEdit[] = scope.rows.map((r) => ({
    variantSku: r.variantSku,
    barcode: r.barcode,
  }));
  const refs = [...new Set(scope.rows.map((r) => r.inboundRef).filter(Boolean))].join(", ");
  const evidence = `loom warehouse scan${refs ? ` · inbound ${refs}` : ""}`;

  if (opts.dryRun) {
    return { scope, report: await planVariantBarcodeEdits(edits, { skipLoom: true }) };
  }

  const report = await applyVariantBarcodeEdits(edits, { evidence, skipLoom: true });
  const summary = summariseSend(report);
  const { pending } = await recordChannelSend(scope.eventIds, summary);
  return { scope, report, summary, stillPending: pending };
}

export interface ChannelSendSummary {
  shopify: { written: number; failed: number; notLive: number; agrees: number };
  sitoo: { written: number; failed: number; notLive: number; agrees: number };
  channelErrors: VariantBarcodeReport["channelErrors"];
}

/** Count the per-row outcomes into something worth storing on the event. */
export function summariseSend(report: VariantBarcodeReport): ChannelSendSummary {
  const tally = (pick: (r: VariantBarcodeReport["rows"][number]) => { state: string }) => {
    const c = { written: 0, failed: 0, notLive: 0, agrees: 0, refused: 0 };
    for (const row of report.rows) {
      const s = pick(row).state;
      if (s === "written" || s === "write") c.written++;
      else if (s === "failed") c.failed++;
      else if (s === "not-live") c.notLive++;
      else if (s === "agrees") c.agrees++;
      else if (s === "refused") c.refused++;
    }
    return c;
  };
  const sh = tally((r) => r.shopify);
  const si = tally((r) => r.sitoo);
  return {
    shopify: { written: sh.written, failed: sh.failed, notLive: sh.notLive, agrees: sh.agrees },
    sitoo: { written: si.written, failed: si.failed, notLive: si.notLive, agrees: si.agrees },
    channelErrors: report.channelErrors,
  };
}

/**
 * Mark the events sent.
 *
 * Only when nothing failed and no channel errored: a Sitoo outage must leave the
 * event pending with its report attached, so the next send picks the rows up
 * again rather than the delivery looking finished with barcodes that never
 * arrived. A row that is `not-live` or `agrees` is not a failure — there was
 * nothing to write there.
 */
export async function recordChannelSend(
  eventIds: string[],
  summary: ChannelSendSummary
): Promise<{ marked: number; pending: boolean }> {
  if (!eventIds.length) return { marked: 0, pending: false };
  const failed =
    summary.shopify.failed + summary.sitoo.failed > 0 ||
    // `loom` is never read here — see the note at the top — so a Loom read error
    // left over from another caller's report must not hold these events open.
    Boolean(summary.channelErrors.shopify) ||
    Boolean(summary.channelErrors.sitoo);

  const res = await prisma.loomInboundEvent.updateMany({
    where: { eventId: { in: eventIds } },
    data: {
      channelReport: summary as unknown as object,
      ...(failed ? {} : { channelsPushedAt: new Date() }),
    },
  });
  return { marked: failed ? 0 : res.count, pending: failed };
}
