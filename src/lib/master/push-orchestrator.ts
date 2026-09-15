// Pushing a batch of colorways to Shopify, Loom and Sitoo — in that order, and
// without ever being a long loop.
//
// THE CONSTRAINT THAT SHAPES ALL OF THIS
//
// There is no job queue in this app, and `maxDuration` is 300s — while
// waitForLoomJob budgets 600s. The existing Loom route can already be killed
// mid-wait. So no invocation here may block on a channel until it finishes:
// PushBatchItem IS the queue. Each call takes a time budget, does what it can,
// persists, and returns `done: false`. A crash loses at most one in-flight item,
// and that item's own state says what the resume has to do.
//
// WHY SHOPIFY FIRST
//
// Loom's stock registry joins on Shopify's InventoryItem gid, which only exists
// once the product is in Shopify. Pushing Loom first would send nulls and need a
// second pass — so the order is Shopify, capture the ids, then Loom, then Sitoo.

import { prisma } from "@/lib/db";
import { pushColorwayToShopify } from "./push-shopify";
import { pushColorwaysToLoom } from "@/lib/loom/push";
import { getLoomJob } from "@/lib/loom/client";
import { shopifyMissing, shopifyBlockingMissing } from "./readiness";
import { getSitooCreator, type SitooCreateInput } from "@/lib/sitoo/create";
import type { Channel } from "@/generated/prisma/enums";

export type PushChannel = "SHOPIFY" | "LOOM" | "SITOO";

export type ItemState =
  | "PENDING"
  | "RUNNING"
  | "AWAITING_JOB"
  | "OK"
  | "FAILED"
  | "BLOCKED"
  | "SKIPPED"
  | "UNCONFIRMED";

/** Shopify first — see the note at the top. */
const PHASES: PushChannel[] = ["SHOPIFY", "LOOM", "SITOO"];

export interface CreatePushBatchInput {
  colorwayIds: string[];
  channels: PushChannel[];
  seasonCode?: string;
  kind?: string;
  allowIncomplete?: boolean;
  note?: string;
  draftId?: string;
}

export interface BatchProgress {
  batchId: string;
  done: boolean;
  status: "running" | "partial" | "ok" | "failed";
  phase: PushChannel | null;
  counts: Record<string, Record<string, number>>;
  nextPollAfterMs?: number;
}

export async function createPushBatch(input: CreatePushBatchInput): Promise<{
  batchId: string;
  items: number;
  blocked: Array<{ colorwayId: string; channel: PushChannel; reason: string }>;
}> {
  const channels = input.channels.length ? input.channels : (["SHOPIFY"] as PushChannel[]);

  const colorways = await prisma.colorway.findMany({
    where: { id: { in: input.colorwayIds } },
    include: {
      style: true,
      brand: true,
      channelContent: true,
      variants: true,
      prices: input.seasonCode ? { where: { season: { code: input.seasonCode } } } : true,
      media: true,
      seasonImages: true,
    },
  });

  const sitooConfigured = Boolean(
    process.env.SITOO_API_ID && process.env.SITOO_API_KEY && process.env.SITOO_BASE_URL
  );

  const blocked: Array<{ colorwayId: string; channel: PushChannel; reason: string }> = [];
  const items: Array<{
    colorwayId: string;
    channel: Channel;
    state: ItemState;
    error?: string;
  }> = [];

  for (const cw of colorways) {
    for (const channel of channels) {
      let state: ItemState = "PENDING";
      let error: string | undefined;

      if (channel === "SHOPIFY") {
        const hasVariants = cw.variants.length > 0;
        const hasPrice = cw.prices.some(
          (p) => p.currency === "NOK" && p.priceType === "MSRP"
        );
        const hard = shopifyBlockingMissing({ hasVariants, hasPrice });
        if (hard.length) {
          state = "BLOCKED";
          error = `missing ${hard.join(", ")}`;
        } else if (!input.allowIncomplete) {
          const soft = shopifyMissing({
            hasVariants,
            hasPrice,
            description:
              cw.channelContent.find(
                (c) => c.channel === "SHOPIFY" && c.field === "fullDescription"
              )?.value ??
              cw.fullDescription ??
              cw.shortDescription,
            hasImage: cw.media.length > 0 || cw.seasonImages.length > 0,
            hasTags: cw.tags.length > 0,
            swatchHex: cw.swatchHex,
            carePageId: cw.carePageId,
            fitguidePageId: cw.fitguidePageId,
          });
          if (soft.length) {
            // NOT waived silently. A candle has no care page or fit guide, and
            // publishing a product page without a description or photograph
            // should take a decision — so the batch reports it and offers a
            // button, rather than deciding on the operator's behalf.
            state = "BLOCKED";
            error = `missing ${soft.join(", ")}`;
          }
        }
      }

      if (channel === "SITOO" && !sitooConfigured) {
        // A configuration fact, not a failure. SITOO_* is absent in Production
        // (WORK-DECK D2), and leaving a batch permanently red for that would
        // teach people to ignore red batches.
        state = "SKIPPED";
        error = "SITOO_* is not configured in this environment";
      }

      if (state !== "PENDING") blocked.push({ colorwayId: cw.id, channel, reason: error! });
      items.push({ colorwayId: cw.id, channel: channel as Channel, state, error });
    }
  }

  const batch = await prisma.pushBatch.create({
    data: {
      kind: input.kind ?? "create",
      seasonCode: input.seasonCode ?? null,
      channels: channels as Channel[],
      allowIncomplete: Boolean(input.allowIncomplete),
      note: input.note ?? null,
      draftId: input.draftId ?? null,
      status: "pending",
      items: { create: items },
    },
    select: { id: true },
  });

  return { batchId: batch.id, items: items.length, blocked };
}

export interface RunOptions {
  /** Hard budget, inside the 300s function ceiling. */
  timeBudgetMs?: number;
  only?: PushChannel[];
  seasonCode?: string;
  dryRun?: boolean;
}

export async function runPushBatch(
  batchId: string,
  opts: RunOptions = {}
): Promise<BatchProgress> {
  const deadline = Date.now() + (opts.timeBudgetMs ?? 240_000);
  const batch = await prisma.pushBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Push batch not found.");

  await prisma.pushBatch.update({ where: { id: batchId }, data: { status: "running" } });

  let nextPollAfterMs: number | undefined;

  for (const phase of PHASES) {
    if (opts.only && !opts.only.includes(phase)) continue;
    if (Date.now() > deadline) break;

    if (phase === "SHOPIFY") await stepShopify(batchId, deadline, batch.seasonCode, opts);
    if (phase === "LOOM") {
      await submitLoom(batchId, batch.seasonCode ?? "CONTINUITY", opts);
      const poll = await confirmLoom(batchId);
      if (poll) nextPollAfterMs = poll;
    }
    if (phase === "SITOO") await stepSitoo(batchId, deadline, opts);
  }

  return finish(batchId, nextPollAfterMs);
}

/**
 * Re-derive anything a crashed invocation left mid-flight, then run.
 *
 * RUNNING means we started and never finished — the channel may or may not have
 * the product. Shopify is asked rather than assumed (adoptExistingShopifyProduct
 * does that inside the push), so a stale RUNNING simply goes back to PENDING.
 * AWAITING_JOB is different: the job id is persisted, so the resume asks Loom
 * about THAT job rather than re-sending the delivery.
 */
export async function resumePushBatch(
  batchId: string,
  opts: RunOptions = {}
): Promise<BatchProgress> {
  await prisma.pushBatchItem.updateMany({
    where: { batchId, state: "RUNNING" },
    data: { state: "PENDING" },
  });
  return runPushBatch(batchId, opts);
}

export async function retryPushBatch(
  batchId: string,
  opts: RunOptions & { channels?: PushChannel[]; colorwayIds?: string[] } = {}
): Promise<BatchProgress> {
  await prisma.pushBatchItem.updateMany({
    where: {
      batchId,
      state: { in: ["FAILED", "BLOCKED", "UNCONFIRMED"] },
      ...(opts.channels ? { channel: { in: opts.channels as Channel[] } } : {}),
      ...(opts.colorwayIds ? { colorwayId: { in: opts.colorwayIds } } : {}),
    },
    data: { state: "PENDING", error: null },
  });
  return runPushBatch(batchId, opts);
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function stepShopify(
  batchId: string,
  deadline: number,
  seasonCode: string | null,
  opts: RunOptions
): Promise<void> {
  const items = await prisma.pushBatchItem.findMany({
    where: { batchId, channel: "SHOPIFY", state: "PENDING" },
  });

  for (const item of items) {
    if (Date.now() > deadline) return;
    await prisma.pushBatchItem.update({
      where: { id: item.id },
      data: { state: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });

    if (opts.dryRun) {
      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: { state: "SKIPPED", error: "dry run", finishedAt: new Date() },
      });
      continue;
    }

    try {
      const res = await pushColorwayToShopify(
        item.colorwayId,
        seasonCode ?? undefined,
        undefined,
        false
      );
      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: {
          state: "OK",
          externalId: res.productGid,
          detail: JSON.parse(
            JSON.stringify({
              action: res.action,
              adopted: res.adopted ?? null,
              variantRefs: res.variantRefs ?? null,
              warnings: res.warnings,
            })
          ),
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: {
          state: "FAILED",
          error: err instanceof Error ? err.message.slice(0, 900) : String(err),
          finishedAt: new Date(),
        },
      });
    }
  }
}

/**
 * Submit the Loom delivery and persist the job id BEFORE waiting on anything.
 *
 * A crash between the POST and the job settling then resumes by asking Loom
 * about that job, rather than re-sending a delivery it may already be running.
 */
async function submitLoom(
  batchId: string,
  seasonCode: string,
  opts: RunOptions
): Promise<void> {
  const pending = await prisma.pushBatchItem.findMany({
    where: { batchId, channel: "LOOM", state: "PENDING" },
  });
  if (!pending.length) return;

  // Loom needs Shopify's ids, so anything whose Shopify push failed waits rather
  // than going out incomplete.
  const shopify = await prisma.pushBatchItem.findMany({
    where: { batchId, channel: "SHOPIFY", colorwayId: { in: pending.map((p) => p.colorwayId) } },
    select: { colorwayId: true, state: true },
  });
  const shopifyState = new Map(shopify.map((s) => [s.colorwayId, s.state]));

  const sendable = pending.filter((p) => {
    const s = shopifyState.get(p.colorwayId);
    return !s || s === "OK" || s === "SKIPPED";
  });
  const waiting = pending.filter((p) => !sendable.includes(p));

  for (const w of waiting)
    await prisma.pushBatchItem.update({
      where: { id: w.id },
      data: { state: "BLOCKED", error: "waiting on the Shopify push for its inventory ids" },
    });

  if (!sendable.length || opts.dryRun) {
    if (opts.dryRun)
      for (const s of sendable)
        await prisma.pushBatchItem.update({
          where: { id: s.id },
          data: { state: "SKIPPED", error: "dry run" },
        });
    return;
  }

  const ids = sendable.map((s) => s.colorwayId);
  const attempt = Math.max(...sendable.map((s) => s.attempts)) + 1;

  try {
    const res = await pushColorwaysToLoom(ids, seasonCode, {
      mode: "data",
      // A retry after a FAILED job rotates the event id: Loom keeps the failure
      // against the original, so an identical resend returns the stale result.
      ...(attempt > 1 ? { eventIdSuffix: `r${attempt}` } : {}),
    });
    for (const s of sendable)
      await prisma.pushBatchItem.update({
        where: { id: s.id },
        data: {
          state: res.ok ? "OK" : "FAILED",
          eventId: res.eventId ?? null,
          error: res.ok ? null : (res.raw ?? "Loom refused the delivery").slice(0, 900),
          attempts: { increment: 1 },
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });
    if (res.ok)
      await prisma.channelPublication.updateMany({
        where: { colorwayId: { in: ids }, channel: "LOOM" },
        data: { loomIdentityPushedAt: new Date() },
      });
  } catch (err) {
    for (const s of sendable)
      await prisma.pushBatchItem.update({
        where: { id: s.id },
        data: {
          state: "FAILED",
          error: err instanceof Error ? err.message.slice(0, 900) : String(err),
          attempts: { increment: 1 },
          finishedAt: new Date(),
        },
      });
  }
}

/** One poll per invocation. Returns a delay when the caller should come back. */
async function confirmLoom(batchId: string): Promise<number | undefined> {
  const waiting = await prisma.pushBatchItem.findMany({
    where: { batchId, channel: "LOOM", state: "AWAITING_JOB", NOT: { jobId: null } },
  });
  if (!waiting.length) return undefined;

  let stillRunning = false;
  for (const item of waiting) {
    const job = await getLoomJob(item.jobId!);
    if (!job) continue;
    if (job.status === "done") {
      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: { state: "OK", finishedAt: new Date(), detail: JSON.parse(JSON.stringify(job)) },
      });
    } else if (job.status === "error") {
      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: {
          state: "FAILED",
          error: job.summary?.fatalError ?? "Loom job failed",
          finishedAt: new Date(),
        },
      });
    } else {
      stillRunning = true;
    }
  }
  return stillRunning ? 5000 : undefined;
}

async function stepSitoo(batchId: string, deadline: number, opts: RunOptions): Promise<void> {
  const items = await prisma.pushBatchItem.findMany({
    where: { batchId, channel: "SITOO", state: "PENDING" },
  });
  if (!items.length) return;

  const colorways = await prisma.colorway.findMany({
    where: { id: { in: items.map((i) => i.colorwayId) } },
    include: {
      style: true,
      brand: { include: { channelRefs: { where: { system: "SITOO", role: "BRAND" } } } },
      categoryRef: true,
      variants: true,
      prices: true,
    },
  });

  const inputs: SitooCreateInput[] = colorways.map((cw) => ({
    colorwayId: cw.id,
    title: cw.name,
    variants: cw.variants.map((v) => ({
      variantId: v.id,
      sku: v.variantSku,
      barcode: v.barcode,
      sizeLabel: v.sizeLabel,
    })),
    priceNok: cw.prices.find((p) => p.priceType === "MSRP" && p.currency === "NOK")?.amount.toString() ?? null,
    costNok: cw.prices.find((p) => p.priceType === "COST" && p.currency === "NOK")?.amount.toString() ?? null,
    manufacturerId: cw.brand?.channelRefs[0]?.externalId ?? null,
    defaultCategoryId: cw.categoryRef?.sitooCategoryId ?? null,
    vatId: null,
    active: true,
    activePos: true,
  }));

  const creator = getSitooCreator();
  try {
    const outcomes = await creator.apply(inputs, { dryRun: opts.dryRun });
    for (const item of items) {
      if (Date.now() > deadline) return;
      const o = outcomes.find((x) => x.colorwayId === item.colorwayId);
      if (!o) continue;

      // Worklist mode never reports OK: nothing was written to Sitoo, and a
      // batch that claims otherwise is exactly the kind of unobserved success
      // this codebase already refuses to make about Loom.
      const state: ItemState = o.mode === "worklist" ? "SKIPPED" : o.ok ? "OK" : "FAILED";

      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: {
          state,
          externalId: o.parentProductId,
          error: o.mode === "worklist" ? "worklist emitted — create in Sitoo, then link" : o.errors.join("; ").slice(0, 900) || null,
          detail: JSON.parse(JSON.stringify({ mode: o.mode, created: o.created })),
          attempts: { increment: 1 },
          finishedAt: new Date(),
        },
      });

      if (o.mode === "api" && o.created.length) {
        for (const c of o.created)
          await prisma.variantChannelRef.upsert({
            where: { variantId_channel: { variantId: c.variantId, channel: "SITOO" } },
            create: {
              variantId: c.variantId,
              channel: "SITOO",
              externalId: c.productId,
              lastPushedAt: new Date(),
              lastPushStatus: "created",
            },
            update: {
              externalId: c.productId,
              lastPushedAt: new Date(),
              lastPushStatus: "created",
            },
          });
      }
    }
  } catch (err) {
    for (const item of items)
      await prisma.pushBatchItem.update({
        where: { id: item.id },
        data: {
          state: "FAILED",
          error: err instanceof Error ? err.message.slice(0, 900) : String(err),
          finishedAt: new Date(),
        },
      });
  }
}

// ---------------------------------------------------------------------------

async function finish(batchId: string, nextPollAfterMs?: number): Promise<BatchProgress> {
  const items = await prisma.pushBatchItem.findMany({
    where: { batchId },
    select: { channel: true, state: true },
  });

  const counts: Record<string, Record<string, number>> = {};
  for (const i of items) {
    (counts[i.channel] ??= {})[i.state] = ((counts[i.channel] ?? {})[i.state] ?? 0) + 1;
  }

  const pending = items.filter((i) =>
    ["PENDING", "RUNNING", "AWAITING_JOB"].includes(i.state)
  ).length;
  const failed = items.filter((i) => ["FAILED", "BLOCKED", "UNCONFIRMED"].includes(i.state)).length;
  const ok = items.filter((i) => i.state === "OK").length;

  const status: BatchProgress["status"] = pending
    ? "running"
    : failed && !ok
      ? "failed"
      : failed
        ? "partial"
        : "ok";

  await prisma.pushBatch.update({ where: { id: batchId }, data: { status } });

  return {
    batchId,
    done: pending === 0,
    status,
    phase: null,
    counts,
    ...(nextPollAfterMs ? { nextPollAfterMs } : {}),
  };
}

export async function getPushBatch(batchId: string) {
  return prisma.pushBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        include: { colorway: { select: { colorwaySku: true, name: true } } },
        orderBy: [{ channel: "asc" }, { state: "asc" }],
      },
    },
  });
}
