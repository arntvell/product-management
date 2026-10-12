import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendInvitation } from "@/lib/auth/invite";

export const dynamic = "force-dynamic";

// POST /api/users/[id]/invite — send (or resend) the Clerk invitation. Admin-only.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (!user.active) return NextResponse.json({ error: "Reactivate this user first." }, { status: 422 });
  return NextResponse.json({ invitation: await sendInvitation(user.email, new URL(req.url).origin) });
}
