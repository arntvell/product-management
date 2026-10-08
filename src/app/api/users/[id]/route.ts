import { NextResponse } from "next/server";
import { updateUser, UserError } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// PUT /api/users/[id] { role?, active? } — admin-only, see permissions.ts
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ user: await updateUser(id, body) });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 422 });
    throw err;
  }
}
