import { NextResponse } from "next/server";
import { ForbiddenError, requirePermission } from "@/lib/auth/session";
import { describeChange, refreshDropStatus, threadflowSeasons } from "@/lib/threadflow/drop-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/cron/threadflow-drops            — every Threadflow season: read, update
// GET /api/cron/threadflow-drops?dryRun=1   — what would change, nothing written
// GET /api/cron/threadflow-drops?season=FW26
//
// The nightly backstop for Threadflow's webhook: a delivery that never arrived
// is caught here the next morning. Same refresh, same SyncRun record.
// Vercel Cron's CRON_SECRET is an ADMIN service call (proxy.ts); admin-only.
export async function GET(req: Request) {
  try {
    await requirePermission("admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const only = url.searchParams.get("season")?.trim().toUpperCase();
  const seasons = only ? [only] : await threadflowSeasons();
  const runs = [];
  for (const season of seasons) {
    try {
      const r = await refreshDropStatus(season, { dryRun, trigger: "cron" });
      runs.push({ ...r, lines: r.changes.map(describeChange) });
    } catch (err) {
      runs.push({ season, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const failed = runs.some((r) => "error" in r);
  return NextResponse.json({ ok: !failed, dryRun, runs }, { status: failed ? 500 : 200 });
}
