import { NextResponse } from "next/server";
import { openFlatRequest, recordFlatUpload, sendFlatToShopify } from "@/lib/master/flats";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/vintage/flats/:id  { url, pathname }  — record an uploaded flat
// POST /api/vintage/flats/:id  { retry: true }    — send it to Shopify again
//
// Only for an open request: see the token route for why that is the guard.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { url?: string; pathname?: string; retry?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!(await openFlatRequest(id)))
    return NextResponse.json({ error: "This product is no longer on the flats list." }, { status: 404 });

  try {
    if (body.retry) return NextResponse.json({ ok: true, ...(await sendFlatToShopify(id)) });
    if (!body.url || !body.pathname)
      return NextResponse.json({ error: "url and pathname are required" }, { status: 400 });
    // Only our own Blob store: the URL becomes a product image.
    if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(body.url))
      return NextResponse.json({ error: "Not an Origo upload" }, { status: 400 });
    const user = await getSessionUser();
    const r = await recordFlatUpload(id, { url: body.url, pathname: body.pathname }, user.email);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
