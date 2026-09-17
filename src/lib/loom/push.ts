// Push master products to Loom's upsert endpoint.
import { prisma } from "@/lib/db";
import { loomIneligibleReason, purposeForMode } from "@/lib/master/readiness";
import type { LoomMode } from "./payload";
import {
  loadColorwaysForLoom,
  buildLoomPayloadFromColorways,
  loomMissingForColorway,
  type LoomPayload,
} from "./payload";
import { loomUpsert, waitForLoomJob, type LoomJob } from "./client";

export interface LoomSkipped {
  colorwayId: string;
  reason: string;
}

export interface LoomPushResult {
  ok: boolean;
  status: number;
  styles: number;
  sent: number; // colorways actually transmitted (0 on a dry run)
  requested: number;
  skipped: LoomSkipped[]; // requested but not sent (not-ready / not-in-season)
  response: unknown;
  raw: string;
  /** True when nothing was transmitted and nothing was marked published. */
  dryRun?: boolean;
  /** The delivery id sent. A failed job keeps its id on Loom's side, so a
   *  retry must use a different one or it returns the stale failure. */
  eventId?: string;
  /** Loom's job id, and what the job actually did once it finished. */
  jobId?: string;
  job?: {
    status: string;
    created?: number;
    updated?: number;
    archived?: number;
    /**
     * What the job did to VARIANTS. `updated` counts colorway rows only, so an
     * identity-only delivery that worked perfectly reports `updated: 0` — which
     * we previously read as "nothing landed" and recorded in the schema as
     * storage being unproven. Confirmed by Loom 2026-09-17.
     */
    variantsCreated?: number;
    variantsUpdated?: number;
    variantsMoved?: number;
    variantsMoveRefused?: number;
    /** Moved SKUs still not reconciled in Pio. Empty is the success case. */
    pioReparentPending?: string[];
    /** Prices actually stored. A list Loom does not know is dropped in silence. */
    pricesCreated?: number;
    pricesUpdated?: number;
    /** Per-item refusals. Empty is the only good value. */
    itemErrors?: unknown[];
    fatalError?: string;
    shapeWarnings?: string[];
    /** Non-fatal by contract — never let these fail a push. */
    warnings?: string[];
    /** The job never settled inside our polling window. */
    unconfirmed?: boolean;
  };
  /** Dry run only: what WOULD be sent, so it can be inspected before it goes. */
  preview?: {
    wouldSend: number;
    styles: number;
    /** Products Loom has not seen before (a first push announces loom:false). */
    newToLoom: number;
    alreadyPublished: number;
    channelsLoomTrue: number;
    channelsLoomFalse: number;
    /** How many carry is_core — visible before sending, not after. */
    core: number;
    dropped: number;
    approvedForProduction: number;
    currencies: string[];
    missingImage: number;
    products: { sku: string; name: string; loomFlag: boolean; variants: number }[];
    payload: LoomPayload;
  };
}

export interface LoomPushOptions {
  /** Build and report the payload without transmitting or recording anything. */
  dryRun?: boolean;
  /**
   * Colorways to WITHDRAW from Loom rather than publish. Sent with
   * channels.loom = false, which archives them in Loom while keeping every
   * order, purchase order and receipt intact.
   */
  archiveColorwayIds?: string[];
  /** Skip waiting for the job to finish. Reports acceptance only. */
  skipJobWait?: boolean;
  /**
   * Override the delivery id. The default is derived from the contents, so an
   * identical resend carries the same id and Loom dedupes it — correct for a
   * retry after a connection failure, wrong when Loom has asked for the same
   * products to be applied again.
   */
  eventId?: string;
  /**
   * Appended to the DERIVED delivery id, for a retry after a FAILED job.
   *
   * A failed job keeps its id on Loom's side, so an identical resend returns the
   * stale failure instead of running again. A retry after a *network* failure
   * must keep the derived id so Loom dedupes it; a retry after a *job* failure
   * must change it. A suffix distinguishes the two without abandoning the
   * content-derived id entirely.
   */
  eventIdSuffix?: string;
  /** "full" for a whole season, "data" for a targeted update. */
  mode?: LoomMode;
  /**
   * Ask Loom to MOVE a variant whose parent colorway has changed, instead of
   * refusing the whole colorway.
   *
   * Off by default, and deliberately so — Loom's refusal is the guard that stops
   * an upstream nesting bug from silently relocating stock, cost and order
   * history. Set it only for a reviewed restructure, such as splitting a
   * collapsed vintage colorway into one colorway per garment.
   *
   * Loom refuses a move regardless of this flag when the variant id already
   * belongs to a different stable row, or when no variant id asserts the move.
   */
  allowVariantReparent?: boolean;
}

export async function pushColorwaysToLoom(
  colorwayIds: string[],
  seasonCode: string,
  opts: LoomPushOptions = {}
): Promise<LoomPushResult> {
  // Which job Loom is doing here decides both eligibility and the readiness
  // gate. "data" is the stock registry, which needs identity for everything
  // that moves; "full" is the wholesale catalogue, which does not.
  const purpose = purposeForMode(opts.mode);

  const loaded = await loadColorwaysForLoom(colorwayIds, seasonCode);
  const loadedById = new Map(loaded.map((c) => [c.id, c]));

  // Partition: only READY colorways present in this season get sent. Everything
  // else is reported as skipped so nothing is silently marked "published".
  const skipped: LoomSkipped[] = [];
  const sendable: typeof loaded = [];
  for (const id of colorwayIds) {
    const cw = loadedById.get(id);
    if (!cw) {
      skipped.push({ colorwayId: id, reason: `not in season ${seasonCode}` });
      continue;
    }
    // Eligibility before readiness. In catalogue mode this keeps externals and
    // vintage out of the wholesale feed; in registry mode nothing is excluded,
    // because stock that does not reach the registry does not reconcile.
    const reason = loomIneligibleReason({ brandIsLivid: cw.brand?.isLivid }, purpose);
    if (reason) {
      skipped.push({ colorwayId: id, reason });
      continue;
    }
    // A withdrawal still has to reach Loom, so an archived colorway bypasses the
    // readiness gate — we are telling Loom to hide it, not to publish it. The
    // registry bypasses it too: it carries identity, not a sellable listing, so
    // a missing description or price is irrelevant to whether stock reconciles.
    const missing =
      cw.archived || purpose === "registry" ? [] : loomMissingForColorway(cw);
    if (missing.length) {
      skipped.push({ colorwayId: id, reason: `missing ${missing.join(", ")}` });
      continue;
    }
    sendable.push(cw);
  }

  if (sendable.length === 0) {
    return {
      ok: false,
      status: 0,
      styles: 0,
      sent: 0,
      requested: colorwayIds.length,
      skipped,
      response: null,
      raw: "No ready colorways to push.",
      dryRun: opts.dryRun,
    };
  }

  // A colorway archived in the master is withdrawn from Loom, always — sending
  // one as live would resurrect a duplicate we deliberately retired. Callers can
  // add more, but cannot send an archived product as published by omission.
  const archive = new Set<string>(opts.archiveColorwayIds ?? []);
  for (const c of sendable) if (c.archived) archive.add(c.id);
  const payload = buildLoomPayloadFromColorways(
    sendable,
    seasonCode,
    archive,
    opts.eventId,
    opts.mode,
    opts.eventIdSuffix,
    opts.allowVariantReparent
  );

  if (opts.dryRun) {
    // Nothing leaves the process and no ChannelPublication is touched.
    const all = payload.styles.flatMap((s) => s.colorways);
    // The merchandising figures below belong to the CATALOGUE payload only.
    //
    // This narrowed on `"prices" in c`, which stopped working the moment the
    // registry payload gained prices. `registry_only` is the field that actually
    // means "this is the registry shape" — it is the flag Loom itself is meant
    // to gate on — so narrowing on its absence says what was always intended.
    const cat = all.filter(
      (c): c is Extract<typeof c, { is_core: unknown }> => !("registry_only" in c)
    );
    const currencies = new Set<string>();
    for (const c of cat) for (const k of Object.keys(c.prices)) currencies.add(k);
    return {
      ok: true,
      status: 0,
      styles: payload.styles.length,
      sent: 0,
      requested: colorwayIds.length,
      skipped,
      response: null,
      raw: "Dry run — nothing was sent to Loom.",
      dryRun: true,
      eventId: payload.event_id,
      preview: {
        wouldSend: all.length,
        styles: payload.styles.length,
        newToLoom: sendable.filter(
          (c) => !c.publications.some((p) => p.channel === "LOOM")
        ).length,
        alreadyPublished: sendable.filter((c) =>
          c.publications.some((p) => p.channel === "LOOM" && p.published)
        ).length,
        channelsLoomTrue: all.filter((c) => c.channels.loom).length,
        channelsLoomFalse: all.filter((c) => !c.channels.loom).length,
        core: cat.filter((c) => c.is_core).length,
        dropped: cat.filter((c) => c.dropped).length,
        approvedForProduction: cat.filter((c) => c.approved_for_production).length,
        currencies: [...currencies].sort(),
        missingImage: cat.filter((c) => !c.image).length,
        products: all.map((c) => ({
          sku: c.colorway_sku,
          name: c.name,
          loomFlag: c.channels.loom,
          variants: c.variants.length,
        })),
        payload,
      },
    };
  }

  const res = await loomUpsert(payload);

  // Trust the response only when BOTH the HTTP status and the body's ok flag
  // agree — a 200 with { ok: false } is a failure, not a success.
  const bodyOk =
    res.data == null || typeof (res.data as { ok?: unknown }).ok !== "boolean"
      ? true
      : (res.data as { ok: boolean }).ok;
  let ok = res.ok && bodyOk;

  // An upsert responds as soon as the payload is ACCEPTED. The job can still
  // fail afterwards, and did once — Loom's database was briefly unreachable and
  // nothing was written, while we recorded 217 products as pushed. Wait for the
  // job to settle so a push is only reported as done when it is done.
  const jobId = (res.data as { jobId?: string } | null)?.jobId;
  let job: LoomPushResult["job"];
  if (ok && jobId && !opts.skipJobWait) {
    const settled: LoomJob | null = await waitForLoomJob(jobId);
    if (!settled) {
      job = { status: "unknown", unconfirmed: true };
      ok = false; // never observed a result — do not claim success
    } else {
      job = {
        status: settled.status,
        created: settled.summary?.created,
        updated: settled.summary?.updated,
        archived: settled.summary?.archived,
        variantsCreated: settled.summary?.variantsCreated,
        variantsUpdated: settled.summary?.variantsUpdated,
        variantsMoved: settled.summary?.variantsMoved,
        variantsMoveRefused: settled.summary?.variantsMoveRefused,
        pioReparentPending: settled.summary?.pioReparentPending,
        pricesCreated: settled.summary?.pricesCreated,
        pricesUpdated: settled.summary?.pricesUpdated,
        itemErrors: settled.summary?.itemErrors,
        fatalError: settled.summary?.fatalError,
        shapeWarnings: settled.summary?.shapeWarnings,
        warnings: settled.summary?.warnings,
        unconfirmed: settled.status === "running" || settled.status === "queued",
      };
      // Only a finished, successful job means published. An errored job clearly
      // is not; neither is one still running when our budget ran out — marking
      // those published records a state we have not observed, which is how the
      // 26 August failure went unnoticed in the first place.
      if (settled.status === "error") ok = false;
      if (job.unconfirmed) ok = false;
      // A refused move skips the whole colorway in Loom's preflight, so the
      // products simply are not there — but the job itself still reports done.
      // Marking those published would record a state Loom does not hold.
      if ((job.variantsMoveRefused ?? 0) > 0) ok = false;
    }
  }

  if (ok) {
    // Mark published ONLY for the colorways actually transmitted. Two bulk
    // statements rather than one upsert per colorway: a per-row round trip
    // overruns the 5 s transaction timeout well before a full season's worth
    // of products, which would fail the push *after* Loom already had the data.
    const sentIds = sendable.filter((c) => !archive.has(c.id)).map((c) => c.id);
    const withdrawnIds = sendable.filter((c) => archive.has(c.id)).map((c) => c.id);
    const pushedAt = new Date();
    await prisma.$transaction(
      [
        prisma.channelPublication.updateMany({
          where: { colorwayId: { in: sentIds }, channel: "LOOM" },
          data: { published: true, lastPushedAt: pushedAt, lastPushStatus: "ok" },
        }),
        prisma.channelPublication.createMany({
          data: sentIds.map((colorwayId) => ({
            colorwayId,
            channel: "LOOM" as const,
            published: true,
            lastPushedAt: pushedAt,
            lastPushStatus: "ok",
          })),
          skipDuplicates: true, // rows the updateMany above already handled
        }),
        ...(withdrawnIds.length
          ? [
              prisma.channelPublication.updateMany({
                where: { colorwayId: { in: withdrawnIds }, channel: "LOOM" },
                data: { published: false, lastPushedAt: pushedAt, lastPushStatus: "withdrawn" },
              }),
            ]
          : []),
      ],
      { timeout: 60_000 }
    );
  }

  return {
    ok,
    status: res.status,
    styles: payload.styles.length,
    sent: ok ? sendable.length : 0,
    requested: colorwayIds.length,
    skipped,
    response: res.data,
    raw: res.raw,
    eventId: payload.event_id,
    jobId,
    job,
  };
}
