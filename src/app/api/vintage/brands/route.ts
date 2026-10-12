import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET  /api/vintage/brands          every maker, archived included, with use
// POST /api/vintage/brands { name } add one (or bring an archived one back)
//
// The list the drop sheet's Brand field offers. A name is matched without
// regard to case, so "levi's" finds "Levi's" rather than making a second one.
export async function GET() {
  const [brands, used] = await Promise.all([
    prisma.vintageBrand.findMany({ orderBy: { name: "asc" } }),
    prisma.vintageDetail.groupBy({ by: ["originalBrand"], _count: { _all: true } }),
  ]);
  const uses = new Map(used.map((u) => [u.originalBrand?.toLowerCase() ?? "", u._count._all]));
  return NextResponse.json({
    ok: true,
    brands: brands.map((b) => ({
      id: b.id,
      name: b.name,
      archived: b.archived,
      garments: uses.get(b.name.toLowerCase()) ?? 0,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return NextResponse.json({ error: "Name the brand." }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: "That name is too long." }, { status: 400 });

  const same = await prisma.vintageBrand.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (same && !same.archived)
    return NextResponse.json({ error: `"${same.name}" is already on the list.` }, { status: 409 });
  const brand = same
    ? await prisma.vintageBrand.update({ where: { id: same.id }, data: { archived: false } })
    : await prisma.vintageBrand.create({ data: { name } });
  return NextResponse.json({ ok: true, brand, restored: !!same }, { status: same ? 200 : 201 });
}
