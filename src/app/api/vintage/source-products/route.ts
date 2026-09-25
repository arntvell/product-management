import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/vintage/source-products
//
// The store's category-level products, which an online garment is written up
// against. Picking one supplies the economics: what that category retails at
// (the online price defaults to it) and what it costs us on average.
export async function GET() {
  const rows = await prisma.vintageSourceProduct.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: {
      name: true,
      sku: true,
      category: true,
      webCategory: true,
      retailNok: true,
      costNok: true,
    },
  });
  return NextResponse.json({
    ok: true,
    products: rows.map((r) => ({
      name: r.name,
      sku: r.sku,
      category: r.category,
      webCategory: r.webCategory,
      retail: r.retailNok?.toString() ?? null,
      // Rounded here rather than in the sheet's fourth decimal place: it is an
      // average across a category's buying, and 210.2492 implies a precision
      // that a one-of-one garment's cost does not have.
      cost: r.costNok == null ? null : String(Math.round(Number(r.costNok))),
    })),
  });
}
