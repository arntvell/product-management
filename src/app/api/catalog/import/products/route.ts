import { NextResponse } from "next/server";
import {
  commitImport,
  parseImportWorkbook,
  ImportError,
  type CategoryDecision,
  type CommitOptions,
} from "@/lib/master/import-products";
import { CategoryError } from "@/lib/master/categories";
import { DraftConflictError } from "@/lib/master/drafts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/import/products — multipart/form-data
//
//   file       the filled-in .xlsx
//   dryRun     "1" to report only (the default posture — the review screen runs
//              this first and nothing is written)
//   channels   JSON array, e.g. ["SHOPIFY","SITOO"]
//   decisions  JSON array of category decisions
//   template   JSON object of the batch's shared fields
//
// The file is uploaded again on commit rather than parked server-side. A parsed
// report cached between the two calls would be a second copy of the truth that
// could drift from the bytes being imported, and the parse is cheap.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Send the workbook as multipart/form-data." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > 10_000_000)
    return NextResponse.json(
      { error: "That file is larger than 10 MB — it is unlikely to be an import sheet." },
      { status: 413 }
    );

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const report = await parseImportWorkbook(buffer);

    const dryRun = form.get("dryRun") !== "0";
    if (dryRun) return NextResponse.json({ ok: true, report, dryRun: true });

    if (!report.ok)
      return NextResponse.json(
        { error: "This file still has errors.", report },
        { status: 422 }
      );

    const opts: CommitOptions = {
      channels: json(form.get("channels"), []) as CommitOptions["channels"],
      decisions: json(form.get("decisions"), []) as CategoryDecision[],
      template: json(form.get("template"), {}) as CommitOptions["template"],
    };

    const result = await commitImport(report, opts);
    return NextResponse.json({ ok: true, report, result }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportError || err instanceof CategoryError)
      return NextResponse.json({ error: err.message }, { status: 422 });
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
}

function json(value: FormDataEntryValue | null, fallback: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
