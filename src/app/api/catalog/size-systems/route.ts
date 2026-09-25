import { NextResponse } from "next/server";
import {
  listSizeSystems,
  createSizeSystem,
  parseSizeRange,
  SizeSystemError,
  type CreateSizeSystemInput,
} from "@/lib/master/size-systems";

export const dynamic = "force-dynamic";

// GET  /api/catalog/size-systems?includeArchived=1
// POST /api/catalog/size-systems  { name, kind, note?, entries[] | range }
//
// `range` is the compact form — "39-46", "S,M,L", "28-36 x 30,32,34" — expanded
// server-side so the UI and any script agree on what it means.
export async function GET(req: Request) {
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({ systems: await listSizeSystems({ includeArchived }) });
}

export async function POST(req: Request) {
  let body: Partial<CreateSizeSystemInput> & { range?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const kind = body.kind ?? "ONE_D";
    const entries = body.entries?.length
      ? body.entries
      : body.range
        ? parseSizeRange(body.range, kind)
        : [];
    const id = await createSizeSystem({
      name: body.name ?? "",
      kind,
      note: body.note ?? null,
      entries,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    if (err instanceof SizeSystemError)
      return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
