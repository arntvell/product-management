import { NextResponse } from "next/server";
import { addToShotList, getShootBoard, removeShootAddition } from "@/lib/master/shoot";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// POST /api/catalog/shoot/additions  { season, ids?: string[], skus?: string[] }
//
// Put products on the season's shot list by hand. Answers with the board rows
// of the products that changed, so the planner can show them straight away.
export async function POST(req: Request) {
  let body: { season?: string; ids?: string[]; skus?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.season) return NextResponse.json({ error: "season is required" }, { status: 400 });
  if (!body.ids?.length && !body.skus?.length) return NextResponse.json({ error: "Pass ids or skus" }, { status: 400 });
  try {
    const user = await getSessionUser();
    const r = await addToShotList(body.season, { ids: body.ids, skus: body.skus }, user.email);
    const board = r.colorwayIds.length ? await getShootBoard(body.season, { colorwayIds: r.colorwayIds }) : null;
    return NextResponse.json({ ok: true, added: r.added, already: r.already, notFound: r.notFound, rows: board?.rows ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not add" }, { status: 500 });
  }
}

// DELETE /api/catalog/shoot/additions  { id }
//
// Take a product added by hand off the shot list.
export async function DELETE(req: Request) {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await removeShootAddition(body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not remove" }, { status: 500 });
  }
}
