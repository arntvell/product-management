import { NextResponse } from "next/server";
import { previewNormalize, runNormalize, type NormalizableField } from "@/lib/master/normalize";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/normalize  { dryRun?: boolean, fields?: ("productType"|"vendor")[] }
export async function POST(req: Request) {
  let body: { dryRun?: boolean; fields?: NormalizableField[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty body -> defaults
  }
  const fields = body.fields?.length ? body.fields : undefined;
  try {
    if (body.dryRun) {
      const preview = await previewNormalize(fields);
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await runNormalize(fields);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Normalize failed" },
      { status: 500 }
    );
  }
}
