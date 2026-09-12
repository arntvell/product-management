import { NextResponse } from "next/server";
import { planSitooPush, pushBarcodesToSitoo } from "@/lib/sitoo/push";

export const dynamic = "force-dynamic";

// POST /api/catalog/push/sitoo   { dryRun?, variantIds?, target? }
//
// Writes corrected barcodes to products that already exist in Sitoo. Nothing is
// created. Rotated size runs are unwound before they are rewritten — see the
// note in src/lib/sitoo/push.ts.
//
// `target: "sandbox"` talks to the sandbox account. Useful for checking API
// behaviour, useless for rehearsing this write set — the sandbox is a separate
// account whose product ids are unrelated, so the SKU guard refuses everything.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; variantIds?: string[]; target?: "production" | "sandbox" } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }
  try {
    if (body.dryRun) {
      const plan = await planSitooPush({ variantIds: body.variantIds, target: body.target });
      return NextResponse.json({ ok: true, dryRun: true, ...plan });
    }
    const result = await pushBarcodesToSitoo({ variantIds: body.variantIds, target: body.target });
    return NextResponse.json({ ok: result.failures.length === 0, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sitoo push failed" },
      { status: 500 }
    );
  }
}
