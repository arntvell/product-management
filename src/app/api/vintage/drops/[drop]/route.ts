import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { barcodeForItemNumber, itemHandle, itemVariantSku } from "@/lib/master/vintage-numbering";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/vintage/drops/DROP%20187
//
// The garments already created for a drop, with where each one has got to.
//
// This exists because creating and pushing are not one act. A create can
// succeed and a push fail — which is exactly what happened to 13763 — and
// until now the sheet could only push what it had created in the same browser
// session, so a failed push left the drop unreachable. A drop is also
// legitimately revisited: photographs arrive through the day, and the Shopify
// push has to wait for them.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ drop: string }> }
) {
  const { drop: raw } = await params;
  const drop = decodeURIComponent(raw).trim();
  if (!drop) return NextResponse.json({ error: "No drop" }, { status: 400 });

  const rows = await prisma.colorway.findMany({
    where: { entries: { some: { drop } } },
    orderBy: { colorwaySku: "asc" },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      status: true,
      tags: true,
      productType: true,
      vintage: true,
      publications: { select: { channel: true, published: true, externalId: true } },
      media: { orderBy: { position: "asc" }, select: { url: true, position: true, shopifyMediaId: true } },
      variants: { select: { variantSku: true, barcode: true, sizeLabel: true } },
      prices: { select: { priceType: true, currency: true, amount: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    drop,
    garments: rows.map((c) => {
      const n = Number(c.colorwaySku.split("-").pop());
      const shopify = c.publications.find((p) => p.channel === "SHOPIFY");
      const loom = c.publications.find((p) => p.channel === "LOOM");
      const msrp = c.prices.find((p) => p.priceType === "MSRP" && p.currency === "NOK");
      const cost = c.prices.find((p) => p.priceType === "COST" && p.currency === "NOK");
      return {
        id: c.id,
        itemNumber: c.vintage?.itemNumber ?? String(n),
        sku: c.colorwaySku,
        variantSku: c.variants[0]?.variantSku ?? itemVariantSku(n),
        handle: itemHandle(n),
        barcode: c.variants[0]?.barcode ?? (Number.isFinite(n) ? barcodeForItemNumber(n) : null),
        name: c.name,
        status: c.status,
        tags: c.tags,
        category: c.productType,
        price: msrp?.amount?.toString() ?? null,
        cost: cost?.amount?.toString() ?? null,
        photos: c.media.map((m) => ({ url: m.url, position: m.position, pushed: !!m.shopifyMediaId })),
        detail: c.vintage,
        // What is left to do, which is the reason to load a drop at all.
        onLoom: !!loom?.published,
        onShopify: !!shopify?.externalId,
      };
    }),
  });
}
