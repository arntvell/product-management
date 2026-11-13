import { NextResponse } from "next/server";
import { authenticatePartner, logPartnerCall } from "@/lib/partner/auth";
import { PartnerRequestError } from "@/lib/partner/external-products";
import { patchSizeSystem } from "@/lib/partner/size-systems";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/partner/v1/size-systems/{id} — Loom's Buying planner.
//
//   { dry_run, loom_key?, confirm_shared?, ops: [{ op: "add", label, dim1?, dim2?, after? } | { op: "reorder", labels }] }
//
// Partner token with `size-systems:write`. All ops or none, through
// updateSizeSystem. A rule refusal (rename, retire, a shared system without
// confirm_shared, …) is a 200 with ok:false and an `error` for a buyer; a
// malformed body is a 400. `loom_key` is accepted for the caller's own
// bookkeeping and not stored. See lib/partner/size-systems.ts.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const auth = await authenticatePartner(req, "size-systems:write");
  if ("response" in auth) return auth.response;
  const tokenName = auth.partner.name;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    await logPartnerCall({ tokenName, req, status: 400, started, error: "body is not JSON" });
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }
  try {
    const { dryRun, ...r } = await patchSizeSystem(id, body);
    await logPartnerCall({
      tokenName,
      req,
      status: 200,
      started,
      items: r.applied.length + r.noop.length,
      ok: r.ok ? r.applied.length : 0,
      dryRun,
      error: r.error,
    });
    return NextResponse.json(r);
  } catch (err) {
    const status = err instanceof PartnerRequestError ? 400 : 500;
    const error = err instanceof Error ? err.message : String(err);
    await logPartnerCall({ tokenName, req, status, started, error });
    return NextResponse.json({ error }, { status });
  }
}
