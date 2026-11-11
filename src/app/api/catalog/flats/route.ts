import { NextResponse } from "next/server";
import { addFlatRequests } from "@/lib/master/flats";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// POST /api/catalog/flats  { ids?: string[], skus?: string[], note?: string }
//
// Queue products for a flat. Admins and Product managers (an unlisted write
// falls to `catalog`); the photographer works the list but does not set it.
export async function POST(req: Request) {
  let body: { ids?: string[]; skus?: string[]; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.ids?.length && !body.skus?.length)
    return NextResponse.json({ error: "Pass ids or skus" }, { status: 400 });
  try {
    const user = await getSessionUser();
    const r = await addFlatRequests({ ids: body.ids, skus: body.skus, note: body.note?.slice(0, 500) }, user.email);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not add" }, { status: 500 });
  }
}
