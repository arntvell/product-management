import { NextResponse } from "next/server";
import { applyBarcodeCorrections } from "@/lib/master/apply-barcodes";

export const dynamic = "force-dynamic";

// POST /api/catalog/barcodes/apply
//   { corrections: [{ variantSku, barcode }], authority, evidence?, dryRun?, overwrite? }
//
// Replaces the generated-SQL path used on 2026-09-11. Same corrections, plus
// canonical form, check-digit validation, a collision guard, a FieldOwner record
// naming the authority, and a ledger entry.
export async function POST(req: Request) {
  let body: {
    corrections?: Array<{ variantSku: string; barcode: string }>;
    authority?: string;
    evidence?: string;
    dryRun?: boolean;
    overwrite?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const corrections = (body.corrections ?? []).filter((c) => c?.variantSku && c?.barcode);
  if (!corrections.length) {
    return NextResponse.json({ error: "corrections is required" }, { status: 400 });
  }
  if (!body.authority?.trim()) {
    return NextResponse.json(
      { error: "authority is required — a correction with no stated authority cannot be defended later" },
      { status: 400 }
    );
  }
  try {
    const result = await applyBarcodeCorrections(corrections, {
      authority: body.authority.trim(),
      evidence: body.evidence ?? null,
      dryRun: body.dryRun,
      overwrite: body.overwrite,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Apply failed" },
      { status: 500 }
    );
  }
}
