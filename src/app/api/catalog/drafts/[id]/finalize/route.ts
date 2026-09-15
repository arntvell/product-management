import { NextResponse } from "next/server";
import { finalizeDraft, FinalizeError } from "@/lib/master/finalize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/drafts/[id]/finalize?dryRun=1
//
// Writes the master only. Channel pushes are a separate, retryable step — this
// call must not be able to leave product half-created because Shopify was slow.
//
// Safe to call twice: the DRAFT -> FINALIZING claim is a single conditional
// UPDATE, so a double-clicked button has exactly one winner, and a draft left
// FINALIZING by a crash resumes by probing its reserved ids.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  try {
    const result = await finalizeDraft(id, { dryRun });
    if ("ok" in result) {
      // A pre-flight report came back instead of a result: it did not pass.
      return NextResponse.json({ ok: result.ok, report: result }, { status: result.ok ? 200 : 422 });
    }
    return NextResponse.json({ ok: true, result }, { status: 201 });
  } catch (err) {
    if (err instanceof FinalizeError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
