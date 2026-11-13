import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { PartnerRequestError } from "@/lib/partner/external-products";
import { addColorwaySizes } from "@/lib/partner/colorway-sizes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/partner/v1/colorway-sizes — Loom's Buying planner, at create POs,
// for a size the buyer added to a line of a product Origio already has.
//
//   { dry_run, season?: "SS27", items: [{ loom_key, colorway_sku, sizes: ["46"], cost_nok, msrp_nok }] }
//
// Partner token with `products:create`. Adds one variant per missing size to the
// colourway (master only, no barcode, publications untouched) and, on a real
// call, returns the whole colourway as a FeedStyle. A size it already has is a
// no-op. A malformed call (no items array, unknown season) is a 400. See
// lib/partner/colorway-sizes.ts and docs/partner-api-loom-buying.md.
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
    const r = await addColorwaySizes(body);
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
