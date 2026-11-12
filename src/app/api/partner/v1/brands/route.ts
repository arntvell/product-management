import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { PartnerRequestError } from "@/lib/partner/external-products";
import { upsertPartnerBrands } from "@/lib/partner/brands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/partner/v1/brands — Loom's Buying planner, at plan lock.
//
//   { dry_run: true,  items: [{ loom_key, loom_brand_id?, name, sku_token?, ... }] }
//   { dry_run: false, items: [...] }   link the brand Origio has, or create it
//
// Partner token with `brands:create`. One entry per item; a refused item is
// `ok: false` with an `error`. See lib/partner/brands.ts and
// docs/partner-api-loom-buying.md.
export async function POST(req: Request) {
  const started = Date.now();
  const auth = await authenticatePartner(req, "brands:create");
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
    const r = await upsertPartnerBrands(body);
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
