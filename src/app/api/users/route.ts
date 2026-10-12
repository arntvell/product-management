import { NextResponse } from "next/server";
import { addUser, listUsers, UserError } from "@/lib/auth/users";
import { sendInvitation } from "@/lib/auth/invite";

export const dynamic = "force-dynamic";

// GET  /api/users — everyone who may use Origo (admin-only, see permissions.ts)
// POST /api/users { email, role, name? } — add someone, and send their Clerk
//      invitation (Clerk is invite-only)
export async function GET() {
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const user = await addUser(body);
    const invitation = await sendInvitation(user.email, new URL(req.url).origin);
    return NextResponse.json({ user, invitation }, { status: 201 });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
