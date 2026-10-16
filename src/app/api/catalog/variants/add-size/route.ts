import { NextResponse } from "next/server";
import { applyAddSize, planAddSize, type AddSizeRequest } from "@/lib/master/add-size";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/variants/add-size
//   { colorwayId, sizeSystemId?, sizes: [{ entryId | variantId, barcode? }], dryRun? }
//
// `entryId` creates a size from the size system. `variantId` carries a size the
// colourway ALREADY has to a channel missing it — no master write, no size
// system needed, and the only form a Threadflow-fed Livid colourway accepts.
//
// Adds sizes to an existing colourway: the master first, then the Shopify
// product and Sitoo family it already has. Loom is not pushed here — the
// response carries `loomGroups` for the caller to send to /api/catalog/push/loom
// with mode "data", because a Loom job can outlast this request. See
// src/lib/master/add-size.ts.
export async function POST(req: Request) {
  let body: Partial<AddSizeRequest> & { dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.colorwayId || !Array.isArray(body.sizes) || !body.sizes.length)
    return NextResponse.json({ error: "colorwayId and sizes are required" }, { status: 400 });
  // `sizeSystemId` is required only to CREATE a size. A request naming existing
  // variants carries a size to a channel and derives nothing, so there is no
  // system to name.
  const propagateOnly = body.sizes.every((s) => s.variantId && !s.entryId);
  if (!propagateOnly && !body.sizeSystemId)
    return NextResponse.json(
      { error: "sizeSystemId is required unless every size names a variantId" },
      { status: 400 }
    );
  if (body.sizes.length > 20)
    return NextResponse.json({ error: "At most 20 sizes at a time" }, { status: 400 });

  const request: AddSizeRequest = {
    colorwayId: body.colorwayId,
    sizeSystemId: body.sizeSystemId,
    sizes: body.sizes.map((s) => ({
      ...(s.entryId ? { entryId: String(s.entryId) } : {}),
      ...(s.variantId ? { variantId: String(s.variantId) } : {}),
      barcode: s.barcode ?? null,
    })),
  };
  try {
    return NextResponse.json(body.dryRun === false ? await applyAddSize(request) : await planAddSize(request));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Adding the size failed" }, { status: 500 });
  }
}
