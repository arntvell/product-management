import { NextResponse } from "next/server";
import { buildImportTemplate } from "@/lib/master/import-template";
import { ImportContextError, resolveTemplateContext } from "@/lib/master/import-context";

export const dynamic = "force-dynamic";

// GET /api/catalog/import/template?brandId=&seasonId=&kind=&sizeSystemIds=a,b&categoryIds=a,b,c
// (`sizeSystemId=` for a single system is still accepted.)
//
// The generated workbook, with the batch's choices already made. Every id is
// resolved here rather than trusted from the query string — the file's Meta
// sheet is what the upload step reads back, so a name written into it has to be
// the name the database holds.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const brandId = q.get("brandId") ?? "";
  const seasonId = q.get("seasonId") ?? "";
  const sizeSystemIds = (q.get("sizeSystemIds") ?? q.get("sizeSystemId") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const kind = q.get("kind") ?? "MERCHANDISE";
  const categoryIds = (q.get("categoryIds") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  try {
    const ctx = await resolveTemplateContext({ brandId, seasonId, kind, sizeSystemIds, categoryIds });
    const { filename, body } = await buildImportTemplate(ctx);

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ImportContextError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the template" },
      { status: 500 }
    );
  }
}
