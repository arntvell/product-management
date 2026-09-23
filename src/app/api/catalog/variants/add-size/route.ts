import { NextResponse } from "next/server";
import { applyAddSize, planAddSize, type AddSizeRequest } from "@/lib/master/add-size";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/variants/add-size
//   { colorwayId, sizeSystemId, sizes: [{ entryId, barcode? }], dryRun? }
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
  if (!body.colorwayId || !body.sizeSystemId || !Array.isArray(body.sizes) || !body.sizes.length)
    return NextResponse.json({ error: "colorwayId, sizeSystemId and sizes are required" }, { status: 400 });
  if (body.sizes.length > 20)
    return NextResponse.json({ error: "At most 20 sizes at a time" }, { status: 400 });

  const request: AddSizeRequest = {
    colorwayId: body.colorwayId,
    sizeSystemId: body.sizeSystemId,
    sizes: body.sizes.map((s) => ({ entryId: String(s.entryId), barcode: s.barcode ?? null })),
  };
  try {
    return NextResponse.json(body.dryRun === false ? await applyAddSize(request) : await planAddSize(request));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Adding the size failed" }, { status: 500 });
  }
}
