// Barcodes the warehouse scanned in, delivered by Loom.
//
// Why this exists, in Ole Eivind's words: he creates external products in Origio
// before anyone knows their barcodes, because an external's barcode is the
// supplier's — printed on the garment — and it is not known until the goods are
// physically here or a list arrives later. Pio matches goods to a purchase order
// by SKU, so Loom will not send an unbarcoded size to Pio and the inbound
// blocks. The workaround is to push those sizes to Pio without barcodes so the
// goods can land in the grid; the warehouse then types each missing barcode into
// Loom as it receives. Once the whole inbound has one, Loom tells Origio, and
// Origio — the master — carries it out to the other systems.
//
// Nothing here is a new write path. The master write is apply-barcodes.ts, the
// same plan/apply pair the variant editor uses, with its own authority on the
// FieldOwner row. See docs/origio-warehouse-barcodes-handover-1.md for Loom's
// side of the contract.
//
// Deliberately NOT done here: the channel push. `applyVariantBarcodeEdits` would
// carry a correction to Shopify and Sitoo in one call, but it reads and writes
// both and does not fit in Loom's 15 s budget, and a Loom push needs a person to
// confirm it. The event row names the colorways instead, and the push stays the
// deliberate act it is everywhere else in Origio.

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { applyBarcodeCorrections, type BarcodeApplyPlan } from "@/lib/master/apply-barcodes";
import { barcodeKey, rejectionReason } from "@/lib/master/barcode";

/** Recorded on FieldOwner for every barcode an inbound brings in. */
export const WAREHOUSE_AUTHORITY = "loom:warehouse-scan";

export const BARCODES_READY = "barcodes.ready";

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

/**
 * Verify `X-Loom-Signature` against the RAW request body.
 *
 * The raw bytes, never a re-serialised parse: `JSON.stringify(JSON.parse(body))`
 * is a different byte string for the same document — key order, number spelling,
 * whitespace — and would fail every time.
 *
 * Returns false rather than throwing on a missing secret, so a receiver deployed
 * before LOOM_WEBHOOK_SECRET is set refuses deliveries instead of accepting
 * them. Loom reads the 401 as retryable and keeps them on its ladder.
 */
export function verifyLoomSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.LOOM_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const provided = header.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

export interface LoomBarcodeRow {
  sku: string;
  product_sku?: string | null;
  origio_variant_id?: string | null;
  size_label?: string | null;
  barcode: string;
  previous_barcode?: string | null;
  entered_at?: string | null;
}

export interface BarcodesReadyPayload {
  event: string;
  event_id: string;
  created_at?: string;
  data: {
    batch_id: string;
    inbound_ref?: string | null;
    po_number?: string | null;
    supplier?: string | null;
    revision: number;
    is_correction?: boolean;
    barcodes: LoomBarcodeRow[];
  };
}

export class LoomPayloadError extends Error {}

/**
 * Read the body into the shape above, or refuse it.
 *
 * A refusal here is the one case that earns a permanent 4xx: a body Origio
 * cannot parse will not parse on the eighth retry either, and Loom's ladder
 * would spend ten hours finding that out.
 */
export function parseBarcodesReady(body: unknown): BarcodesReadyPayload {
  if (!body || typeof body !== "object") throw new LoomPayloadError("Body is not an object");
  const b = body as Record<string, unknown>;
  const data = b.data as Record<string, unknown> | undefined;
  if (typeof b.event !== "string") throw new LoomPayloadError("Missing `event`");
  if (typeof b.event_id !== "string" || !b.event_id) throw new LoomPayloadError("Missing `event_id`");
  if (!data || typeof data !== "object") throw new LoomPayloadError("Missing `data`");
  if (typeof data.batch_id !== "string" || !data.batch_id)
    throw new LoomPayloadError("Missing `data.batch_id`");
  if (typeof data.revision !== "number" || !Number.isFinite(data.revision))
    throw new LoomPayloadError("Missing `data.revision`");
  if (!Array.isArray(data.barcodes)) throw new LoomPayloadError("Missing `data.barcodes`");
  for (const [i, r] of (data.barcodes as unknown[]).entries()) {
    const row = r as Record<string, unknown> | null;
    if (!row || typeof row !== "object") throw new LoomPayloadError(`barcodes[${i}] is not an object`);
    if (typeof row.sku !== "string" || !row.sku)
      throw new LoomPayloadError(`barcodes[${i}] has no \`sku\``);
    if (typeof row.barcode !== "string")
      throw new LoomPayloadError(`barcodes[${i}] has no \`barcode\``);
  }
  return body as BarcodesReadyPayload;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export interface UnfiledRow {
  sku: string;
  barcode: string;
  reason: string;
}

export interface ProcessResult {
  /** What the route answers with. Every one of these is a 2xx. */
  status: "processed" | "duplicate" | "superseded";
  eventId: string;
  batchId: string;
  revision: number;
  counts: { rows: number; filled: number; changed: number; unchanged: number; unfiled: number };
  unfiled: UnfiledRow[];
  affectedColorwayIds: string[];
  /** Set when the event was seen before; the route still answers 2xx. */
  note?: string;
}

interface Resolved {
  row: LoomBarcodeRow;
  variantId: string;
  variantSku: string;
  colorwayId: string;
  current: string | null;
  authority: string | null;
}

/**
 * Match Loom's rows to variants in the master.
 *
 * Three keys, in descending order of trust:
 *
 *   1. `origio_variant_id` — Origio's own cuid, which is what the Loom payload
 *      carries as `variant_id`. An exact id match and the only one that cannot
 *      be wrong. Null for sizes created before Origio sent stable ids.
 *   2. `VariantChannelRef.externalSku` on the LOOM channel — the alias column,
 *      which exists for exactly this: one garment, two spellings, the channel's
 *      one recorded rather than merged.
 *   3. `variantSku` — the master's own spelling, when the two agree.
 *
 * SKU, not barcode: the barcode is the thing being filled in, so it cannot also
 * be the thing that identifies the row.
 */
async function resolveRows(rows: LoomBarcodeRow[]) {
  const byId = rows.map((r) => r.origio_variant_id).filter((x): x is string => !!x);
  const skus = rows.map((r) => r.sku);

  const [byIdRows, aliasRows, bySkuRows] = await Promise.all([
    byId.length
      ? prisma.variant.findMany({
          where: { id: { in: byId } },
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

  const idMap = new Map(byIdRows.map((v) => [v.id, v]));
  const aliasMap = new Map(
    aliasRows.filter((a) => a.externalSku).map((a) => [a.externalSku!, a.variant])
  );
  const skuMap = new Map(bySkuRows.map((v) => [v.variantSku, v]));

  const resolved: Resolved[] = [];
  const unknown: LoomBarcodeRow[] = [];
  for (const row of rows) {
    const v =
      (row.origio_variant_id ? idMap.get(row.origio_variant_id) : undefined) ??
      aliasMap.get(row.sku) ??
      skuMap.get(row.sku);
    if (!v) {
      unknown.push(row);
      continue;
    }
    resolved.push({
      row,
      variantId: v.id,
      variantSku: v.variantSku,
      colorwayId: v.colorwayId,
      current: v.barcode,
      authority: null,
    });
  }

  // Who last decided the barcode on each resolved variant — the correction rule
  // below turns on it.
  if (resolved.length) {
    const owners = await prisma.fieldOwner.findMany({
      where: { entityType: "variant", field: "barcode", entityId: { in: resolved.map((r) => r.variantId) } },
      select: { entityId: true, authority: true },
    });
    const ownerMap = new Map(owners.map((o) => [o.entityId, o.authority]));
    for (const r of resolved) r.authority = ownerMap.get(r.variantId) ?? null;
  }

  return { resolved, unknown };
}

/**
 * File one `barcodes.ready` delivery.
 *
 * Idempotent on `event_id`, and gated on `revision` per `batch_id`. Never throws
 * for a row it cannot file — see `unfiled`.
 */
export async function processBarcodesReady(payload: BarcodesReadyPayload): Promise<ProcessResult> {
  const { event_id: eventId, data } = payload;
  const base = { eventId, batchId: data.batch_id, revision: data.revision };

  // 1. Dedupe. A retry after a lost response is normal and must change nothing.
  const seen = await prisma.loomInboundEvent.findUnique({ where: { eventId } });
  if (seen) {
    const counts = (seen.counts as ProcessResult["counts"] | null) ?? {
      rows: 0, filled: 0, changed: 0, unchanged: 0, unfiled: 0,
    };
    return {
      ...base,
      status: "duplicate",
      counts,
      unfiled: (seen.unfiled as UnfiledRow[] | null) ?? [],
      affectedColorwayIds: (seen.affectedColorwayIds as string[] | null) ?? [],
      note: `Already processed at ${seen.processedAt?.toISOString() ?? seen.receivedAt.toISOString()}.`,
    };
  }

  // 2. Revision gate. A correction re-sends the whole batch at a higher
  //    revision; after a retry a LOWER one can arrive late, and applying it
  //    would undo the correction. Stored, so the late arrival is answerable.
  const highest = await prisma.loomInboundEvent.findFirst({
    where: { batchId: data.batch_id, status: "processed" },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  if (highest && data.revision <= highest.revision) {
    await prisma.loomInboundEvent.create({
      data: {
        eventId,
        event: payload.event,
        batchId: data.batch_id,
        inboundRef: data.inbound_ref ?? null,
        poNumber: data.po_number ?? null,
        revision: data.revision,
        isCorrection: data.is_correction ?? false,
        status: "superseded",
        payload: payload as unknown as object,
      },
    });
    return {
      ...base,
      status: "superseded",
      counts: { rows: data.barcodes.length, filled: 0, changed: 0, unchanged: 0, unfiled: 0 },
      unfiled: [],
      affectedColorwayIds: [],
      note: `Revision ${data.revision} is not newer than ${highest.revision} already processed for this batch.`,
    };
  }

  // 3. Sort the rows. A row Origio will not file is set aside BEFORE the master
  //    write, so the two apply calls below carry only rows that can succeed.
  const { resolved, unknown } = await resolveRows(data.barcodes);
  const unfiled: UnfiledRow[] = unknown.map((r) => ({
    sku: r.sku,
    barcode: r.barcode,
    reason: "no variant in Origio matches this SKU or variant id",
  }));

  const fills: Resolved[] = [];
  const corrections: Resolved[] = [];
  for (const r of resolved) {
    const reason = rejectionReason(r.row.barcode);
    if (reason || !barcodeKey(r.row.barcode)) {
      // All four of the lengths Loom sends — EAN-8, UPC-A, EAN-13, GTIN-14 —
      // are accepted by `barcode.ts`, so what lands here is a code that is not a
      // GTIN at all: a wrong length, or a failed check digit. The warehouse
      // typed it and a scanner read it, so it is worth a human looking at rather
      // than a silent drop.
      //
      // `!barcodeKey(...)` is not redundant beside `reason`: an empty barcode is
      // "absent, which is allowed" to `rejectionReason` and still nothing to
      // file.
      unfiled.push({ sku: r.variantSku, barcode: r.row.barcode, reason: reason ?? "not a barcode" });
      continue;
    }
    if (!r.current) {
      fills.push(r);
      continue;
    }
    if (barcodeKey(r.current) === barcodeKey(r.row.barcode)) {
      fills.push(r); // counted `unchanged` by the plan; kept for the tally
      continue;
    }
    // The variant already holds a DIFFERENT barcode. Loom's §4 says Origio is
    // the master, so a value somebody here decided wins — unless this is the
    // warehouse correcting the barcode it entered itself, which the previous
    // one being ours and the authority being ours together prove.
    const replacesOwn =
      r.authority === WAREHOUSE_AUTHORITY &&
      !!r.row.previous_barcode &&
      barcodeKey(r.row.previous_barcode) === barcodeKey(r.current);
    if (replacesOwn) corrections.push(r);
    else
      unfiled.push({
        sku: r.variantSku,
        barcode: r.row.barcode,
        reason: `Origio holds ${r.current}${r.authority ? ` (${r.authority})` : ""}`,
      });
  }

  // 4. The master. Two calls, because `overwrite` is per-call: a fill must never
  //    silently replace, and a correction must.
  const evidence = `loom inbound ${data.inbound_ref ?? data.batch_id} · ${eventId}`;
  const plans: BarcodeApplyPlan[] = [];
  for (const [group, overwrite] of [
    [fills, false],
    [corrections, true],
  ] as const) {
    if (!group.length) continue;
    plans.push(
      await applyBarcodeCorrections(
        group.map((r) => ({ variantSku: r.variantSku, barcode: r.row.barcode })),
        { authority: WAREHOUSE_AUTHORITY, evidence, owner: "MANUAL", overwrite }
      )
    );
  }

  for (const p of plans) {
    for (const r of p.rejected) unfiled.push({ sku: r.variantSku, barcode: r.barcode, reason: r.reason });
    for (const c of p.collisions)
      unfiled.push({ sku: c.variantSku, barcode: c.barcode, reason: `held by ${c.heldBy}` });
    for (const sku of p.unknownSku)
      unfiled.push({ sku, barcode: "", reason: "variant disappeared between plan and apply" });
  }

  const filled = plans.reduce((a, p) => a + p.fill.length, 0);
  const changed = plans.reduce((a, p) => a + p.change.length, 0);
  const unchanged = plans.reduce((a, p) => a + p.unchanged, 0);

  const written = new Set<string>([
    ...plans.flatMap((p) => p.fill.map((f) => f.variantSku)),
    ...plans.flatMap((p) => p.change.map((c) => c.variantSku)),
  ]);
  const affectedColorwayIds = [
    ...new Set(resolved.filter((r) => written.has(r.variantSku)).map((r) => r.colorwayId)),
  ];

  const counts = { rows: data.barcodes.length, filled, changed, unchanged, unfiled: unfiled.length };

  await prisma.loomInboundEvent.create({
    data: {
      eventId,
      event: payload.event,
      batchId: data.batch_id,
      inboundRef: data.inbound_ref ?? null,
      poNumber: data.po_number ?? null,
      revision: data.revision,
      isCorrection: data.is_correction ?? false,
      status: "processed",
      payload: payload as unknown as object,
      counts,
      unfiled: unfiled as unknown as object,
      affectedColorwayIds,
      processedAt: new Date(),
    },
  });

  return { ...base, status: "processed", counts, unfiled, affectedColorwayIds };
}
