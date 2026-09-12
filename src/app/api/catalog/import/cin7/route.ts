import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { previewCin7Import, runCin7Import, type ImportGate } from "@/lib/cin7/import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/import/cin7  { dryRun?, brands?, allowlist? }
//
// `allowlist` is a path to the JSON that reconcile.py emits. Supplying it
// replaces the original gate — in stock, right now, at six locations — which is
// why the master holds only about a third of what the POS sells. The allowlist
// carries product the live stock check would miss and excludes what it would
// wrongly admit: materials, test rows, and the EEXT-/EXT- twins.
//
// The allowlist is a snapshot. Re-run fetch.py and reconcile.py before a real
// import, or it will drag in product that has since sold out and miss product
// that has since arrived.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; brands?: string[]; allowlist?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — defaults apply
  }

  let gate: ImportGate | undefined;
  if (body.allowlist) {
    try {
      const raw = await readFile(path.join(process.cwd(), body.allowlist), "utf8");
      const parsed = JSON.parse(raw) as { allowSkus?: string[]; denySkus?: string[] };
      gate = { allowSkus: parsed.allowSkus ?? [], denySkus: parsed.denySkus ?? [] };
    } catch (err) {
      return NextResponse.json(
        { error: `Could not read allowlist: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 }
      );
    }
  }

  try {
    if (body.dryRun) {
      const preview = await previewCin7Import(body.brands, gate);
      return NextResponse.json({
        dryRun: true,
        gate: gate ? { allow: gate.allowSkus?.length ?? 0, deny: gate.denySkus?.length ?? 0 } : null,
        ...preview,
      });
    }
    const result = await runCin7Import(body.brands, gate);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
