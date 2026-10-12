// Check or import a workbook — the part the file upload and the typed-in
// import share once they both have bytes.

import { NextResponse } from "next/server";
import {
  commitImport,
  parseImportWorkbook,
  ImportError,
  type CategoryDecision,
  type CommitOptions,
} from "./import-products";
import { CategoryError } from "./categories";
import { DraftConflictError } from "./drafts";
import { ImportContextError } from "./import-context";

export async function runImport(
  buffer: Buffer,
  opts: { dryRun: boolean; channels: CommitOptions["channels"]; decisions: CategoryDecision[] }
): Promise<NextResponse> {
  try {
    const report = await parseImportWorkbook(buffer);
    if (opts.dryRun) return NextResponse.json({ ok: true, report, dryRun: true });
    if (!report.ok)
      return NextResponse.json({ error: "This file still has errors.", report }, { status: 422 });
    const result = await commitImport(report, { channels: opts.channels, decisions: opts.decisions });
    return NextResponse.json({ ok: true, report, result }, { status: 201 });
  } catch (err) {
    return importFailure(err);
  }
}

export function importFailure(err: unknown): NextResponse {
  if (err instanceof ImportError || err instanceof CategoryError)
    return NextResponse.json({ error: err.message }, { status: 422 });
  if (err instanceof ImportContextError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof DraftConflictError)
    return NextResponse.json({ error: err.message }, { status: 409 });
  // A new model whose migration has not been deployed yet reads as P2021.
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2021")
    return NextResponse.json(
      {
        error:
          "A table this importer needs does not exist in this database yet. The migration " +
          "has not been deployed.",
      },
      { status: 503 }
    );
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Import failed" },
    { status: 500 }
  );
}
