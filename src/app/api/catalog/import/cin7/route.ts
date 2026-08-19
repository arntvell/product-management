import { NextResponse } from "next/server";
import { previewCin7Import, runCin7Import } from "@/lib/cin7/import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/import/cin7  { dryRun?: boolean }
// dryRun => preview counts only; otherwise runs the live import into the master.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; brands?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — defaults apply
  }

  try {
    if (body.dryRun) {
      const preview = await previewCin7Import(body.brands);
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await runCin7Import(body.brands);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
