import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildSku, validateSku, type SkuInput } from "@/lib/master/sku";

export const dynamic = "force-dynamic";

// POST /api/catalog/skus/validate
//   { sku } | { suggest: { prefix, style, color?, size?, modifiers? } }
//
// Backs the product builder: checks a typed SKU against the master before the
// product is created, or proposes one from the garment's attributes. Generating
// is the stronger of the two — two people entering the same garment then produce
// the same string, and the unique index rejects the second.
export async function POST(req: Request) {
  let body: { sku?: string; suggest?: SkuInput };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await prisma.colorway.findMany({ select: { colorwaySku: true } });
  const corpus = existing.map((c) => c.colorwaySku);

  if (body.suggest) {
    const proposed = buildSku(body.suggest);
    return NextResponse.json({
      ok: true,
      proposed,
      validation: validateSku(proposed, corpus),
    });
  }
  if (!body.sku?.trim()) {
    return NextResponse.json({ error: "sku or suggest is required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, validation: validateSku(body.sku, corpus) });
}
