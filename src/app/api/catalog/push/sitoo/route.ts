import { NextResponse } from "next/server";
import { planSitooPush, pushBarcodesToSitoo } from "@/lib/sitoo/push";

export const dynamic = "force-dynamic";

// POST /api/catalog/push/sitoo   { dryRun?, variantIds? }
//
// Writes corrected barcodes to products that already exist in Sitoo. Nothing is
// created. Rotated size runs are unwound before they are rewritten — see the
// note in src/lib/sitoo/push.ts.
//
// Point SITOO_BASE_URL at the sandbox before the first live run.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; variantIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    if (body.dryRun) {
      const plan = await planSitooPush({ variantIds: body.variantIds });
      return NextResponse.json({ ok: true, dryRun: true, ...plan });
    }
    const result = await pushBarcodesToSitoo({ variantIds: body.variantIds });
    return NextResponse.json({ ok: result.failures.length === 0, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sitoo push failed" },
      { status: 500 }
    );
  }
}
