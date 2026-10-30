import { NextResponse } from "next/server";
import { ForbiddenError, requirePermission } from "@/lib/auth/session";
import { runStockArrivals } from "@/lib/master/stock-arrivals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/cron/stock-arrivals            — read Loom, record, alert (the cron)
// GET /api/cron/stock-arrivals?dryRun=1   — what would be alerted, nothing written
//
// Vercel Cron calls this with GET and `Authorization: Bearer <CRON_SECRET>`,
// which the proxy treats as a service call with the ADMIN role — the same
// path the vintage reveal takes. Admin-only, so an admin can also run it by
// opening the URL; nobody else can.
export async function GET(req: Request) {
  try {
    await requirePermission("admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  try {
    const run = await runStockArrivals({ dryRun });
    return NextResponse.json({ ok: true, ...run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stock check failed" },
      { status: 500 }
    );
  }
}
