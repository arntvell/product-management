import { NextResponse } from "next/server";
import { getBrandTemplate } from "@/lib/master/queries";

export const dynamic = "force-dynamic";

// GET /api/catalog/brands/[id]/template — the brand's saved defaults (or null).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await getBrandTemplate(id);
  return NextResponse.json({ template });
}
