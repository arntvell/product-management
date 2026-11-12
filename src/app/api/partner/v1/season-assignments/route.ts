import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { PartnerRequestError } from "@/lib/partner/external-products";
import { assignToSeason } from "@/lib/partner/season-assignments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/partner/v1/season-assignments — Loom's Buying planner, at plan lock,
// for products Origio already has (carry-overs).
//
//   { dry_run, season: "SS27", items: [{ loom_key, colorway_sku, msrp_nok, cost_nok? }] }
//
// Partner token with `seasons:write`. Puts each colourway in the season and sets
// the season's NOK MSRP (and COST when sent). Nothing is pushed. A malformed call
// (no season, unknown or non-regular season, no items) is a 400. See
// lib/partner/season-assignments.ts and docs/partner-api-loom-buying.md.
export async function POST(req: Request) {
  const started = Date.now();
  const auth = await authenticatePartner(req, "seasons:write");
  if ("response" in auth) return auth.response;
  const tokenName = auth.partner.name;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await logPartnerCall({ tokenName, req, status: 400, started, error: "body is not JSON" });
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  try {
    const r = await assignToSeason(body);
    const ok = r.items.filter((i) => i.ok).length;
    await logPartnerCall({ tokenName, req, status: 200, started, items: r.items.length, ok, dryRun: r.dryRun });
    return NextResponse.json({ items: r.items });
  } catch (err) {
    const status = err instanceof PartnerRequestError ? 400 : 500;
    const error = err instanceof Error ? err.message : String(err);
    await logPartnerCall({ tokenName, req, status, started, error });
    return NextResponse.json({ error }, { status });
  }
}
