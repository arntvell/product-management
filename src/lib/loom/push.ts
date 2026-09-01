// Push master products to Loom's upsert endpoint.
import { prisma } from "@/lib/db";
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
  /** Loom's job id, and what the job actually did once it finished. */
  jobId?: string;
  job?: {
    status: string;
    created?: number;
    updated?: number;
    archived?: number;
    fatalError?: string;
    shapeWarnings?: string[];
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
}

export async function pushColorwaysToLoom(
  colorwayIds: string[],
  seasonCode: string,
  opts: LoomPushOptions = {}
): Promise<LoomPushResult> {
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
    // A withdrawal still has to reach Loom, so an archived colorway bypasses the
    // readiness gate — we are telling Loom to hide it, not to publish it.
    const missing = cw.archived ? [] : loomMissingForColorway(cw);
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
  const payload = buildLoomPayloadFromColorways(sendable, seasonCode, archive);

  if (opts.dryRun) {
    // Nothing leaves the process and no ChannelPublication is touched.
    const all = payload.styles.flatMap((s) => s.colorways);
    const currencies = new Set<string>();
    for (const c of all) for (const k of Object.keys(c.prices)) currencies.add(k);
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
        dropped: all.filter((c) => c.dropped).length,
        approvedForProduction: all.filter((c) => c.approved_for_production).length,
        currencies: [...currencies].sort(),
        missingImage: all.filter((c) => !c.image).length,
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
        fatalError: settled.summary?.fatalError,
        shapeWarnings: settled.summary?.shapeWarnings,
        unconfirmed: settled.status === "running" || settled.status === "queued",
      };
      // Only a finished, successful job means published. An errored job clearly
      // is not; neither is one still running when our budget ran out — marking
      // those published records a state we have not observed, which is how the
      // 26 August failure went unnoticed in the first place.
      if (settled.status === "error") ok = false;
      if (job.unconfirmed) ok = false;
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
    jobId,
    job,
  };
}
