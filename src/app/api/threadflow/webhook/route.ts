import { NextResponse, after } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { refreshDropStatus, threadflowSeasons } from "@/lib/threadflow/drop-status";

export const dynamic = "force-dynamic";
// Node, not edge: the signature check is node:crypto.
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/threadflow/webhook — Threadflow says a product changed.
//
// Signed, not logged in. Either Standard Webhooks headers with Threadflow's
// `whsec_` secret (THREADFLOW_SECRET), or `X-Threadflow-Signature: sha256=<hex>`
// over the raw body (THREADFLOW_WEBHOOK_SECRET). Public in proxy.ts for that
// reason, like Loom's barcode webhook.
//
// The body is a trigger, not data:
//
//   { "event": "colorway.dropped", "season_code": "FW26" }
//   { "event": "colorway.updated", "season_id": "<Threadflow season id>" }
//   { "event": "colorway.restored" }          — no season: every Threadflow season
//
// Any event name is accepted. Origio then reads the season from Threadflow's
// read API and updates the cancelled / approved flags (lib/threadflow/
// drop-status.ts), so the figures are Threadflow's own at the moment of
// reading — a late or repeated delivery does no harm.
//
// Answers 202 at once; the refresh runs after the answer. The outcome is a
// SyncRun row (source "threadflow", mode "drop-status").
//
//   202  accepted            401  bad or missing signature
//   400  body is not JSON    404  the season named is not in Origio

/** Configured secrets: Threadflow's own (`whsec_…`) and the plain one. */
function secrets(): string[] {
  return [process.env.THREADFLOW_SECRET, process.env.THREADFLOW_WEBHOOK_SECRET].filter((s): s is string => !!s);
}

function same(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Standard Webhooks (what a `whsec_` secret means): `webhook-id`,
 * `webhook-timestamp` and `webhook-signature: v1,<base64>` — several,
 * space-separated, during a key rotation — over `id.timestamp.body`, keyed with
 * the base64 after `whsec_`. Svix sends the same with `svix-` headers. A
 * timestamp more than five minutes off is refused, so a captured delivery
 * cannot be replayed later.
 */
function verifyStandard(raw: string, h: Headers): boolean {
  const id = h.get("webhook-id") ?? h.get("svix-id");
  const ts = h.get("webhook-timestamp") ?? h.get("svix-timestamp");
  const sig = h.get("webhook-signature") ?? h.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const provided = sig.split(" ").map((p) => p.split(",")[1]).filter(Boolean);
  return secrets().some((secret) => {
    const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
    const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`, "utf8").digest("base64");
    return provided.some((p) => same(p, expected));
  });
}

/** The plain scheme: `X-Threadflow-Signature: sha256=<hex>` over the raw body. */
function verifyPlain(raw: string, header: string | null): boolean {
  if (!header) return false;
  const provided = header.replace(/^sha256=/i, "").trim();
  return secrets().some((secret) =>
    same(provided, createHmac("sha256", secret).update(raw, "utf8").digest("hex"))
  );
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyStandard(raw, req.headers) && !verifyPlain(raw, req.headers.get("x-threadflow-signature")))
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: { event?: unknown; season_code?: unknown; season_id?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  const event = typeof body.event === "string" ? body.event : "unknown";

  let seasons: string[];
  if (typeof body.season_code === "string" && body.season_code.trim()) {
    seasons = [body.season_code.trim().toUpperCase()];
  } else if (typeof body.season_id === "string" && body.season_id.trim()) {
    const s = await prisma.season.findUnique({ where: { threadflowId: body.season_id.trim() }, select: { code: true } });
    if (!s) return NextResponse.json({ error: `no Origio season for Threadflow season ${body.season_id}` }, { status: 404 });
    seasons = [s.code];
  } else {
    seasons = await threadflowSeasons();
  }
  const known = await prisma.season.findMany({ where: { code: { in: seasons } }, select: { code: true } });
  if (!known.length) return NextResponse.json({ error: `no Origio season ${seasons.join(", ")}` }, { status: 404 });

  after(async () => {
    for (const { code } of known) {
      try {
        await refreshDropStatus(code, { trigger: `webhook:${event}` });
      } catch (err) {
        // Recorded on the SyncRun row; the nightly check retries.
        console.error(`threadflow webhook: ${code}:`, err);
      }
    }
  });
  return NextResponse.json({ accepted: true, event, seasons: known.map((s) => s.code) }, { status: 202 });
}
