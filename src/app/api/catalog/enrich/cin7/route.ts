import { NextResponse } from "next/server";
import {
  previewCin7Enrichment,
  runCin7Enrichment,
  type Cin7Field,
} from "@/lib/master/enrich-cin7";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID: Cin7Field[] = [
  "hsCode",
  "customsDescription",
  "weightKg",
  "fiberComposition",
  "countryOfOrigin",
];

// POST /api/catalog/enrich/cin7
//   { dryRun?: boolean, seasonCode?: string, fields?: Cin7Field[] }
// Fill the customs block on CIN7_IMPORT products from Cin7's additional
// attributes. Non-destructive: empty fields only, MANUAL locks respected.
export async function POST(req: Request) {
  let body: { dryRun?: boolean; seasonCode?: string; fields?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const fields = body.fields?.length
    ? (body.fields.filter((f): f is Cin7Field => VALID.includes(f as Cin7Field)) as Cin7Field[])
    : undefined;
  if (body.fields?.length && !fields?.length) {
    return NextResponse.json(
      { error: `fields must be any of: ${VALID.join(", ")}` },
      { status: 400 }
    );
  }

  const opts = { seasonCode: body.seasonCode, fields };
  try {
    if (body.dryRun) {
      const preview = await previewCin7Enrichment(opts);
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await runCin7Enrichment(opts);
    return NextResponse.json({ dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cin7 enrichment failed" },
      { status: 500 }
    );
  }
}
