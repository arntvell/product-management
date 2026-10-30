import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { markStockAlertsSeen, unseenStockAlerts } from "@/lib/master/stock-arrivals";

export const dynamic = "force-dynamic";

// GET  /api/alerts/stock                   — the signed-in user's unseen stock alerts
// POST /api/alerts/stock  { alertIds }     — mark them seen, so each shows once
//
// For Admins and Product managers only: the receipts are made for those two
// roles when an alert is raised, and anyone else simply has none.
export async function GET() {
  const user = await getSessionUser();
  // No id without Clerk (the shared-password mode): nobody to show it to.
  if (!user.id || !can(user.role, "catalog")) return NextResponse.json({ alerts: [] });
  return NextResponse.json({ alerts: await unseenStockAlerts(user.id) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user.id) return NextResponse.json({ ok: true, seen: 0 });
  let body: { alertIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(body.alertIds) ? body.alertIds.filter((x) => typeof x === "string") : [];
  return NextResponse.json({ ok: true, seen: await markStockAlertsSeen(user.id, ids) });
}
