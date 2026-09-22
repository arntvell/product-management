import { NextResponse } from "next/server";
import { finalizeDraft, preflightDraft, FinalizeError } from "@/lib/master/finalize";
import type { PreflightReport } from "@/lib/master/finalize";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Row {
  id: string;
  ok: boolean;
  created: boolean;
  error: string | null;
  report: PreflightReport | null;
  counts: { colorways: number; variants: number } | null;
}

// POST /api/catalog/drafts/batch — { ids: string[], action: "check" | "create" }
//
// An import of twenty styles is twenty drafts, and walking each one through the
// wizard's review screen to press the same button is not a review — it is
// twenty chances to stop reading. So the checks are collated here.
//
// "create" is still a per-draft finalizeDraft: the claim, the reserved ids and
// the resume probe are per draft, and one transaction spanning the batch would
// mean one bad style rolling back nineteen good ones. A draft whose pre-flight
// fails is REPORTED, never skipped silently — the count of what was not created
// is the point of the screen.
export async function POST(req: Request) {
  let body: { ids?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  const action = body.action === "create" ? "create" : "check";
  if (!ids.length) return NextResponse.json({ error: "No drafts given." }, { status: 400 });
  if (ids.length > 100)
    return NextResponse.json({ error: "Too many drafts in one call." }, { status: 400 });

  const rows: Row[] = [];

  // Sequential on purpose. finalizeDraft opens a transaction and the SKU corpus
  // lookups are not free; running a hundred in parallel is how a pool gets
  // exhausted mid-batch and half the drafts fail for a reason that has nothing
  // to do with the product.
  for (const id of ids) {
    try {
      if (action === "check") {
        const report = await preflightDraft(id);
        rows.push({
          id,
          ok: report.ok,
          created: false,
          error: null,
          report,
          counts: { colorways: report.counts.colorways, variants: report.counts.variants },
        });
        continue;
      }
      const result = await finalizeDraft(id);
      if ("ok" in result) {
        // A PreflightReport came back: nothing was created.
        rows.push({
          id,
          ok: false,
          created: false,
          error: null,
          report: result,
          counts: { colorways: result.counts.colorways, variants: result.counts.variants },
        });
      } else {
        rows.push({
          id,
          ok: true,
          created: true,
          error: null,
          report: null,
          counts: { colorways: result.colorwayIds.length, variants: result.variantCount },
        });
      }
    } catch (err) {
      rows.push({
        id,
        ok: false,
        created: false,
        error:
          err instanceof FinalizeError || err instanceof Error
            ? err.message
            : "Failed",
        report: null,
        counts: null,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    action,
    rows,
    summary: {
      total: rows.length,
      passed: rows.filter((r) => r.ok).length,
      created: rows.filter((r) => r.created).length,
      blocked: rows.filter((r) => !r.ok).length,
    },
  });
}
