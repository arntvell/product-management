import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { PartnerRequestError } from "@/lib/partner/external-products";
import { getSizeSystems } from "@/lib/partner/size-systems";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/partner/v1/size-systems?colorway_sku=… | ?brand=<origio_brand_id|name>
//
// Partner token with `size-systems:read`. By colourway: the systems add-size and
// colorway-sizes would draw its sizes from, plus the sizes it has. `in_use` means a variant of a brand defaulting to the system holds the label. By brand: its
// default system. An unknown colourway or brand is a 200 with `systems: []` and
// an `error`; only a call naming neither is a 400. See lib/partner/size-systems.ts.
export async function GET(req: Request) {
  const started = Date.now();
  const auth = await authenticatePartner(req, "size-systems:read");
  if ("response" in auth) return auth.response;
  const tokenName = auth.partner.name;
  const url = new URL(req.url);
  try {
    const r = await getSizeSystems({ colorway_sku: url.searchParams.get("colorway_sku"), brand: url.searchParams.get("brand") });
    await logPartnerCall({ tokenName, req, status: 200, started, items: r.systems.length, ok: r.systems.length, error: r.error });
    return NextResponse.json(r);
  } catch (err) {
    const status = err instanceof PartnerRequestError ? 400 : 500;
    const error = err instanceof Error ? err.message : String(err);
    await logPartnerCall({ tokenName, req, status, started, error });
    return NextResponse.json({ error }, { status });
  }
}
