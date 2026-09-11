import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RANGE_INTERNAL, RANGE_PRODUCTION, recordIssued } from "@/lib/master/barcode";

export const dynamic = "force-dynamic";

// GET  /api/catalog/barcodes/ledger   — high-water mark per range
// POST /api/catalog/barcodes/ledger   — { entries: [{ barcode, sku?, authority }] }
//
// The ledger is the record of every barcode issued, whoever issued it. Loading
// the CFO list into it is what lets the master allocate without reissuing a
// number that is already printed on a garment.
export async function GET() {
  const rows = await Promise.all(
    [RANGE_PRODUCTION, RANGE_INTERNAL].map(async (range) => {
      const top = await prisma.barcodeAllocation.findFirst({
        where: { range },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const count = await prisma.barcodeAllocation.count({ where: { range } });
      return { range, highWaterMark: top?.sequence ?? 0, issued: count };
    })
  );
  return NextResponse.json({ ok: true, ranges: rows });
}

export async function POST(req: Request) {
  let body: { entries?: Array<{ barcode: string; sku?: string; authority?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const entries = (body.entries ?? []).filter((e) => e && e.barcode);
  if (!entries.length) {
    return NextResponse.json({ error: "entries is required" }, { status: 400 });
  }
  try {
    const result = await recordIssued(
      prisma,
      entries.map((e) => ({
        barcode: e.barcode,
        sku: e.sku ?? null,
        authority: e.authority ?? "import",
      }))
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ledger load failed" },
      { status: 500 }
    );
  }
}
