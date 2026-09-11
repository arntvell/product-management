import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recordDecisions } from "@/lib/master/provenance";

export const dynamic = "force-dynamic";

// POST /api/catalog/lock
//   { variantSkus: [...], field: "barcode", authority, evidence? }
//
// Freeze a field the master must not assert until a human settles it. A locked
// barcode is skipped by both channel writers, so a disputed value cannot leave
// the building because somebody forgot which rows were in question.
export async function POST(req: Request) {
  let body: {
    variantSkus?: string[];
    field?: string;
    authority?: string;
    evidence?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const skus = (body.variantSkus ?? []).filter(Boolean);
  const field = body.field?.trim() || "barcode";
  if (!skus.length || !body.authority?.trim()) {
    return NextResponse.json(
      { error: "variantSkus and authority are required" },
      { status: 400 }
    );
  }
  try {
    const variants = await prisma.variant.findMany({
      where: { variantSku: { in: skus } },
      select: { id: true, variantSku: true },
    });
    const written = await recordDecisions(
      variants.map((v) => ({
        entityType: "variant" as const,
        entityId: v.id,
        field,
        owner: "MANUAL" as const,
        authority: body.authority!.trim(),
        evidence: body.evidence ?? null,
        lock: true,
      }))
    );
    return NextResponse.json({
      ok: true,
      locked: written,
      field,
      notFound: skus.filter((s) => !variants.some((v) => v.variantSku === s)),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lock failed" },
      { status: 500 }
    );
  }
}
