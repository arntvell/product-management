import { NextResponse } from "next/server";
import { linkSitooProducts } from "@/lib/sitoo/link";

export const dynamic = "force-dynamic";

// POST /api/catalog/sitoo/link   { dryRun? }
//
// Matches Origio variants to the Sitoo products that already represent them,
// by SKU and then by barcode. Must be run before any push: the first write has
// to be an update, never a create, or the POS catalogue doubles.
//
// `target` picks which Sitoo to read and defaults to SITOO_TARGET, which is
// `sandbox` in development. Writing production links from a sandbox read is
// refused — see the note on allowSandboxWrites.
export async function POST(req: Request) {
  let body: {
    dryRun?: boolean;
    target?: "production" | "sandbox";
    allowSandboxWrites?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — defaults to a live run
  }
  try {
    const result = await linkSitooProducts({
      dryRun: body.dryRun,
      target: body.target,
      allowSandboxWrites: body.allowSandboxWrites,
    });
    return NextResponse.json({ ok: true, dryRun: Boolean(body.dryRun), ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sitoo link failed" },
      { status: 500 }
    );
  }
}
