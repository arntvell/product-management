import { NextResponse } from "next/server";
import { preflightDraft, FinalizeError } from "@/lib/master/finalize";

export const dynamic = "force-dynamic";

// POST /api/catalog/drafts/[id]/preflight — what would block this create.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, report: await preflightDraft(id) });
  } catch (err) {
    if (err instanceof FinalizeError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Preflight failed" },
      { status: 500 }
    );
  }
}
