import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH /api/vintage/brands/[id] { name?, archived? }
//
// Renaming changes what the sheet offers from now on. It does not retag
// garments already made — those carry the old spelling on Shopify, and changing
// a live tag is its own decision.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; archived?: boolean };
  const data: { name?: string; archived?: boolean } = {};
  if (typeof body.archived === "boolean") data.archived = body.archived;
  if (typeof body.name === "string") {
    const name = body.name.trim().replace(/\s+/g, " ");
    if (!name) return NextResponse.json({ error: "Name the brand." }, { status: 400 });
    const clash = await prisma.vintageBrand.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, id: { not: id } },
    });
    if (clash) return NextResponse.json({ error: `"${clash.name}" is already on the list.` }, { status: 409 });
    data.name = name;
  }
  try {
    const brand = await prisma.vintageBrand.update({ where: { id }, data });
    return NextResponse.json({ ok: true, brand });
  } catch {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }
}
