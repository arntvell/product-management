import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildImportTemplate } from "@/lib/master/import-template";
import { listSizeSystems } from "@/lib/master/size-systems";

export const dynamic = "force-dynamic";

// GET /api/catalog/import/template?brandId=&seasonId=&kind=&sizeSystemId=&categoryId=
//
// The generated workbook, with the batch's choices already made. Every id is
// resolved here rather than trusted from the query string — the file's Meta
// sheet is what the upload step reads back, so a name written into it has to be
// the name the database holds.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const brandId = q.get("brandId") ?? "";
  const seasonId = q.get("seasonId") ?? "";
  const sizeSystemId = q.get("sizeSystemId") ?? "";
  const kind = q.get("kind") ?? "MERCHANDISE";
  const categoryId = q.get("categoryId");

  const missing = [
    !brandId && "brand",
    !seasonId && "season",
    !sizeSystemId && "size system",
  ].filter(Boolean);
  if (missing.length)
    return NextResponse.json(
      { error: `Choose a ${missing.join(", a ")} before generating the file.` },
      { status: 400 }
    );

  try {
    const [brand, season, systems, category] = await Promise.all([
      prisma.brand.findUnique({
        where: { id: brandId },
        select: { id: true, name: true, isLivid: true },
      }),
      prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, code: true } }),
      listSizeSystems(),
      categoryId
        ? prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } })
        : null,
    ]);

    if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    if (brand.isLivid)
      return NextResponse.json(
        {
          error:
            "Livid product comes from Threadflow. This importer creates external brands only.",
        },
        { status: 422 }
      );
    if (!season) return NextResponse.json({ error: "Season not found." }, { status: 404 });
    const sizeSystem = systems.find((s) => s.id === sizeSystemId);
    if (!sizeSystem)
      return NextResponse.json({ error: "Size system not found." }, { status: 404 });

    const { filename, body } = await buildImportTemplate({
      brandId: brand.id,
      brandName: brand.name,
      seasonId: season.id,
      seasonCode: season.code,
      kind,
      sizeSystem,
      categoryName: category?.name ?? null,
    });

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the template" },
      { status: 500 }
    );
  }
}
