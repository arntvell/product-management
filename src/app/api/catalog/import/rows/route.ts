import { NextResponse } from "next/server";
import type { CategoryDecision, CommitOptions } from "@/lib/master/import-products";
import { resolveTemplateContext, workbookFromRows, type BatchChoice, type TypedRow } from "@/lib/master/import-context";
import { importFailure, runImport } from "@/lib/master/import-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/import/rows
//   { batch: { brandId, seasonId, kind, sizeSystemIds, categoryIds },
//     rows: [{ style, colorway, size, priceIn, priceOut, barcode, category, sizeSystem }],
//     dryRun, channels, decisions }
//
// Several styles for one brand, typed on the import page instead of into a
// downloaded file. The rows are written into that same file and imported from
// it (workbookFromRows), so the checks, the review and the one-draft-per-style
// result are the file import's own. Same response as /import/products.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    batch?: BatchChoice;
    rows?: TypedRow[];
    dryRun?: boolean;
    channels?: CommitOptions["channels"];
    decisions?: CategoryDecision[];
  } | null;
  if (!body?.batch) return NextResponse.json({ error: "Define the batch first." }, { status: 400 });
  try {
    const ctx = await resolveTemplateContext(body.batch);
    const buffer = await workbookFromRows(ctx, body.rows ?? []);
    return runImport(buffer, {
      dryRun: body.dryRun !== false,
      channels: body.channels ?? [],
      decisions: body.decisions ?? [],
    });
  } catch (err) {
    return importFailure(err);
  }
}
