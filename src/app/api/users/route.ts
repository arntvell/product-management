import { NextResponse } from "next/server";
import { addUser, listUsers, UserError } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// GET  /api/users — everyone who may use Origo (admin-only, see permissions.ts)
// POST /api/users { email, role, name? } — add someone; they sign in with Google
export async function GET() {
  return NextResponse.json({ users: await listUsers() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ user: await addUser(body) }, { status: 201 });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
