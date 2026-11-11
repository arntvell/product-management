import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { PartnerRequestError } from "@/lib/partner/external-products";
import { writeMasterData } from "@/lib/partner/master-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// PATCH /api/partner/v1/variants/master-data — barcodes and customs from Loom.
//
//   { items: [{ variant_sku, barcode?, hs_code?, country_of_origin?,
//               customs_description?, weight_kg?, fiber_composition? }],
//     dry_run?: boolean, evidence?: string }
//
// Partner token with `master-data:write`. One entry per item; a refused size
// is `ok: false` with an `error`, never a failed call. See
// lib/partner/master-data.ts.
export async function PATCH(req: Request) {
  const started = Date.now();
  const auth = await authenticatePartner(req, "master-data:write");
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
    const r = await writeMasterData(body);
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
