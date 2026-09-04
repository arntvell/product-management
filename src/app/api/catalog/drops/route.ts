import { NextResponse } from "next/server";
import { parseHandleList, setDrop, setDropByHandles } from "@/lib/master/drops";

export const dynamic = "force-dynamic";

// POST /api/catalog/drops
//   { entryIds: string[], drop: string | null }                  — by selection
//   { handles: string[] | string, seasonCode, drop: string|null } — by handle
//
// The handle form resolves against the whole catalogue rather than the rows the
// board is showing, so a pasted list works from any tab. Anything it could not
// assign comes back in a labelled bucket — see setDropByHandles.
export async function POST(req: Request) {
  let body: {
    entryIds?: string[];
    handles?: string[] | string;
    seasonCode?: string;
    drop?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const hasEntryIds = Array.isArray(body.entryIds) && body.entryIds.length > 0;
  const hasHandles =
    typeof body.handles === "string"
      ? body.handles.trim().length > 0
      : Array.isArray(body.handles) && body.handles.length > 0;

  if (hasEntryIds === hasHandles) {
    return NextResponse.json(
      { error: "Provide exactly one of entryIds or handles" },
      { status: 400 }
    );
  }

  try {
    if (hasEntryIds) {
      const result = await setDrop(body.entryIds!, body.drop ?? null);
      return NextResponse.json({ ok: true, ...result });
    }

    const seasonCode = body.seasonCode?.trim();
    if (!seasonCode) {
      return NextResponse.json(
        { error: "seasonCode is required when assigning by handle" },
        { status: 400 }
      );
    }
    const handles =
      typeof body.handles === "string"
        ? parseHandleList(body.handles)
        : (body.handles ?? []).flatMap((h) => parseHandleList(h));
    if (!handles.length) {
      return NextResponse.json(
        { error: "No handles found in the pasted text" },
        { status: 400 }
      );
    }
    const result = await setDropByHandles(seasonCode, handles, body.drop ?? null);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to set drop" },
      { status: 500 }
    );
  }
}
