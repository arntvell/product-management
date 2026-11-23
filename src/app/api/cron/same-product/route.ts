import { NextResponse } from "next/server";
import { ForbiddenError, requirePermission } from "@/lib/auth/session";
import { runSameProduct } from "@/lib/master/same-product";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/cron/same-product            — refresh custom.same_product on every live Livid product
// GET /api/cron/same-product?dryRun=1   — what would change, nothing written
//
// Hourly, because the inputs move on their own: a colour sells out, is
// restocked, goes live or is tagged SALE. The rule is in lib/master/same-product.ts.
// Same auth as the other crons: Vercel's CRON_SECRET is treated as an admin
// service call, and an admin can open the URL by hand.
export async function GET(req: Request) {
  try {
    await requirePermission("admin");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  try {
    const r = await runSameProduct({ apply: !dryRun });
    return NextResponse.json({
      ok: r.errors.length === 0,
      applied: r.applied,
      liveProducts: r.liveProducts,
      unchanged: r.unchanged,
      changed: r.changes.length,
      written: r.written,
      origioFixed: r.origioFixed,
      prelaunchSet: r.prelaunchFixed,
      linksAdded: r.linksAdded,
      linksDropped: r.linksDropped,
      errors: r.errors,
      changes: r.changes.map((c) => ({
        sku: c.sku,
        add: c.add.map((g) => r.labels[g]),
        drop: c.drop.map((g) => r.labels[g]),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "same_product refresh failed" },
      { status: 500 }
    );
  }
}
