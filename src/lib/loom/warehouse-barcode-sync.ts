// Carrying warehouse barcodes out to the channels.
//
// The receiver files a barcode in the master and stops there: Shopify and Sitoo
// writes do not fit inside Loom's 15 s reply budget, and a Loom push needs a
// person. So the master holds barcodes that the channels do not, and this is the
// step that closes that gap.
//
// Nothing here writes a channel itself. It works out WHAT should be sent and
// hands it to `variant-barcodes.ts`, which is the path the variant editor
// already uses — master first, then every Shopify variant and Sitoo product the
// garment is linked to, then Loom per season, with the guards those modules
// carry (check digit, one code per garment, rotations, archived colourways,
// wrong-product ids). A second route to the same channels would be a second set
// of guards to keep right.
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
  /** Distinct colorways, which is the unit Loom is pushed in. */
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
}

/**
 * Preview or carry out the send.
 *
 * A preview reads Shopify, Sitoo and Loom and changes nothing; an apply writes
 * the master (a no-op — see the note at the top), Shopify and Sitoo, and returns
 * `loomGroups` for the caller to push. Loom is the caller's job for the reason
 * the editor has it that way: a Loom job can outlast one request.
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

  const report = opts.dryRun
    ? await planVariantBarcodeEdits(edits)
    : await applyVariantBarcodeEdits(edits, { evidence });

  return { scope, report };
}

export interface ChannelSendSummary {
  shopify: { written: number; failed: number; notLive: number; agrees: number };
  sitoo: { written: number; failed: number; notLive: number; agrees: number };
  loom: { written: number; failed: number; refused: number };
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
  const lo = tally((r) => r.loom);
  return {
    shopify: { written: sh.written, failed: sh.failed, notLive: sh.notLive, agrees: sh.agrees },
    sitoo: { written: si.written, failed: si.failed, notLive: si.notLive, agrees: si.agrees },
    loom: { written: lo.written, failed: lo.failed, refused: lo.refused },
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
    summary.shopify.failed + summary.sitoo.failed + summary.loom.failed > 0 ||
    Object.values(summary.channelErrors).some(Boolean);

  const res = await prisma.loomInboundEvent.updateMany({
    where: { eventId: { in: eventIds } },
    data: {
      channelReport: summary as unknown as object,
      ...(failed ? {} : { channelsPushedAt: new Date() }),
    },
  });
  return { marked: failed ? 0 : res.count, pending: failed };
}
