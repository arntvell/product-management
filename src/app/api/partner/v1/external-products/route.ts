import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { createExternalProducts, PartnerRequestError } from "@/lib/partner/external-products";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/partner/v1/external-products — Loom's Buying planner.
//
//   { dry_run: true,  season: "SS27", items: [...] }   the SKUs, nothing saved
//   { dry_run: false, season: "SS27", items: [...] }   create, LOOM-only, unpublished
//
// Partner token with `products:create` (lib/partner/auth.ts). One entry per
// item comes back; a refused item is `ok: false` with an `error` for a buyer,
// never a failed call. Only a malformed call (no season, an unknown season, no
// items) is a 400. See lib/partner/external-products.ts.
export async function POST(req: Request) {
  const started = Date.now();
  const auth = await authenticatePartner(req, "products:create");
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
    const r = await createExternalProducts(body);
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
