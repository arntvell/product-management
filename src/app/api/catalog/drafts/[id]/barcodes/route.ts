import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftBarcodeCsv, applyBarcodeCsv } from "@/lib/master/draft-barcodes";
import { parseDraftPayload } from "@/lib/master/draft-payload";
import { saveDraft, DraftConflictError } from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

// GET  /api/catalog/drafts/[id]/barcodes — the CSV, sorted style/colour/size
// POST /api/catalog/drafts/[id]/barcodes — { csv, revision, dryRun? }
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { filename, body } = await draftBarcodeCsv(id);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { csv?: string; revision?: number; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.csv) return NextResponse.json({ error: "csv is required" }, { status: 400 });

  const draft = await prisma.productDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  try {
    const current = parseDraftPayload(draft.payload);
    const { payload, report } = applyBarcodeCsv(current, body.csv);

    if (body.dryRun)
      return NextResponse.json({ ok: true, report: { ...report, dryRun: true } });

    // Through the same compare-and-swap as autosave, so an import cannot race a
    // tab that is still editing.
    const saved = await saveDraft(id, {
      revision: body.revision ?? draft.revision,
      payload,
    });
    return NextResponse.json({ ok: true, report, revision: saved.revision, payload });
  } catch (err) {
    if (err instanceof DraftConflictError)
      return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
