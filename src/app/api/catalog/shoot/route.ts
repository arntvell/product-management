import { NextResponse } from "next/server";
import { SHOOT_STATUSES, setShootPlan } from "@/lib/master/shoot";
import { getSessionUser } from "@/lib/auth/session";
import type { ShootStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

// POST /api/catalog/shoot  { entryId, status: ShootStatus | null, note: string | null }
//
// A person's shoot decision for one season entry. Null status hands the
// product back to the planner's own rule (no media + in stock → shoot).
export async function POST(req: Request) {
  let body: { entryId?: string; status?: string | null; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  const status = body.status ?? null;
  if (status !== null && !SHOOT_STATUSES.includes(status as ShootStatus)) {
    return NextResponse.json({ error: `Unknown status ${status}` }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;

  try {
    const user = await getSessionUser();
    const saved = await setShootPlan(body.entryId, { status: status as ShootStatus | null, note }, user.email);
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save the shoot plan" },
      { status: 500 }
    );
  }
}
