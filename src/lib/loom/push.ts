// Push master products to Loom's upsert endpoint.
import { prisma } from "@/lib/db";
import {
  loadColorwaysForLoom,
  buildLoomPayloadFromColorways,
  loomMissingForColorway,
} from "./payload";
import { loomUpsert } from "./client";

export interface LoomSkipped {
  colorwayId: string;
  reason: string;
}

export interface LoomPushResult {
  ok: boolean;
  status: number;
  styles: number;
  sent: number; // colorways actually transmitted
  requested: number;
  skipped: LoomSkipped[]; // requested but not sent (not-ready / not-in-season)
  response: unknown;
  raw: string;
}

export async function pushColorwaysToLoom(
  colorwayIds: string[],
  seasonCode: string
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
    const missing = loomMissingForColorway(cw);
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
    };
  }

  const payload = buildLoomPayloadFromColorways(sendable, seasonCode);
  const res = await loomUpsert(payload);

  // Trust the response only when BOTH the HTTP status and the body's ok flag
  // agree — a 200 with { ok: false } is a failure, not a success.
  const bodyOk =
    res.data == null || typeof (res.data as { ok?: unknown }).ok !== "boolean"
      ? true
      : (res.data as { ok: boolean }).ok;
  const ok = res.ok && bodyOk;

  if (ok) {
    // Mark published ONLY for the colorways actually transmitted. Two bulk
    // statements rather than one upsert per colorway: a per-row round trip
    // overruns the 5 s transaction timeout well before a full season's worth
    // of products, which would fail the push *after* Loom already had the data.
    const sentIds = sendable.map((c) => c.id);
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
      ],
      { timeout: 60_000 }
    );
  }

  return {
    ok,
    status: res.status,
    styles: payload.styles.length,
    sent: sendable.length,
    requested: colorwayIds.length,
    skipped,
    response: res.data,
    raw: res.raw,
  };
}
