import { NextResponse } from "next/server";
import { SHOOT_STATUSES, setShootPlan, setShootPrepared, type ShootRowKind } from "@/lib/master/shoot";
import { getSessionUser } from "@/lib/auth/session";
import type { ShootStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

// POST /api/catalog/shoot
//   { entryId, kind?, status: ShootStatus | null, note: string | null }
//   { entryId, kind?, prepared: boolean }
//
// A person's shoot decision for one row, or the prepared tick. `kind` is
// "entry" (a SeasonEntry, the default) or "added" (a ShootAddition). Null
// status hands the product back to the planner's own rule (no media + in
// stock → shoot; added by hand → on the list).
export async function POST(req: Request) {
  let body: { entryId?: string; kind?: string; status?: string | null; note?: string | null; prepared?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  const kind: ShootRowKind = body.kind === "added" ? "added" : "entry";

  try {
    const user = await getSessionUser();
    if (typeof body.prepared === "boolean") {
      const saved = await setShootPrepared(kind, body.entryId, body.prepared, user.email);
      return NextResponse.json({ ok: true, ...saved });
    }
    const status = body.status ?? null;
    if (status !== null && !SHOOT_STATUSES.includes(status as ShootStatus)) {
      return NextResponse.json({ error: `Unknown status ${status}` }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
    const saved = await setShootPlan(kind, body.entryId, { status: status as ShootStatus | null, note }, user.email);
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save the shoot plan" },
      { status: 500 }
    );
  }
}
