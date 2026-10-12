import { NextResponse } from "next/server";
import {
  applyCollectionChange,
  collectionMetafieldDefs,
  listLiveCollections,
  type CollectionChange,
} from "@/lib/shopify/live-collections";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET  /api/live-collections   every collection on the store, with the store's
//                              collection metafield definitions as columns
// POST /api/live-collections   { changes: [{ id, fields?, metafields? }] }
//                              written to the live store now; one result each
export async function GET() {
  try {
    const defs = await collectionMetafieldDefs();
    const collections = await listLiveCollections(defs);
    const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    return NextResponse.json({ defs, collections, adminBase: store ? `https://${store}/admin` : null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read collections" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { changes?: CollectionChange[] } | null;
  const changes = body?.changes ?? [];
  if (!changes.length) return NextResponse.json({ error: "No changes" }, { status: 400 });
  if (changes.length > 300) return NextResponse.json({ error: "More than 300 collections at once." }, { status: 413 });
  try {
    const defs = await collectionMetafieldDefs();
    const results = [];
    for (const ch of changes) {
      try {
        results.push(await applyCollectionChange(ch, defs));
      } catch (err) {
        results.push({ id: ch.id, ok: false, errors: [err instanceof Error ? err.message : String(err)] });
      }
    }
    return NextResponse.json({ results, ok: results.every((r) => r.ok) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 502 });
  }
}
