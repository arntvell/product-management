import { NextResponse } from "next/server";
import { getBrandTemplate } from "@/lib/master/queries";
import { prisma } from "@/lib/db";
import { categorySlug } from "@/lib/master/reference-pull";

export const dynamic = "force-dynamic";

// GET /api/catalog/brands/[id]/template — the brand's saved defaults (or null).
//
// `categoryId` is resolved here rather than stored on BrandTemplate: the
// template predates the Category model and still holds free text. Resolving on
// read means a brand whose category text later gains a modelled Category starts
// prefilling the picker with no migration, and a text value nobody has modelled
// yet simply leaves the picker empty instead of failing.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await getBrandTemplate(id);
  if (!template) return NextResponse.json({ template: null });

  let categoryId = "";
  if (template.category) {
    const match = await prisma.category.findUnique({
      where: { slug: categorySlug(template.category) },
      select: { id: true, archived: true },
    });
    // An archived category is never offered at creation, so it must not be
    // prefilled either — that would reintroduce it one product at a time.
    if (match && !match.archived) categoryId = match.id;
  }

  return NextResponse.json({ template: { ...template, categoryId } });
}
