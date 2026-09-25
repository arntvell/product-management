import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  listVintagePhotos,
  matchPhotosToItems,
  VintagePhotoError,
} from "@/lib/vintage/photos";
import { vintageSku } from "@/lib/master/vintage-create";
import {
  VintageDropSheet,
  type ShareItem,
} from "@/components/catalog/vintage-drop-sheet";

// The sFTP listing needs Node, and it is the page's whole starting point.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function loadShare(): Promise<
  { items: ShareItem[]; error: null } | { items: null; error: string }
> {
  try {
    const byItem = await listVintagePhotos();
    const numbers = [...byItem.keys()].sort((a, b) => Number(a) - Number(b));
    const existing = await prisma.colorway.findMany({
      where: { colorwaySku: { in: numbers.map(vintageSku) } },
      select: { id: true, name: true, colorwaySku: true },
    });
    const bySku = new Map(existing.map((e) => [e.colorwaySku, e]));
    const match = matchPhotosToItems(numbers, byItem);

    return {
      items: numbers.map((n) => {
        const found = bySku.get(vintageSku(n));
        return {
          itemNumber: n,
          photos: (byItem.get(n) ?? []).map((p) => ({
            url: p.url,
            index: p.index,
            filename: p.filename,
          })),
          existing: found ? { id: found.id, name: found.name } : null,
          missingBasePhoto: match.missingBasePhoto.includes(n),
        };
      }),
      error: null,
    };
  } catch (err) {
    return {
      items: null,
      error:
        err instanceof VintagePhotoError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not read the photo share",
    };
  }
}

export default async function VintageDropPage() {
  const share = await loadShare();

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <Link
          href="/catalog"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          ← Catalog
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Vintage drop</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Seeded from the photo share rather than from a blank form: the shoot has
          already photographed these, so every row here has a picture and a garment
          with no row is visible instead of lost. Create in Origio, send the stock to
          Loom, push to Shopify, then move the drop to the top of the collection.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          The share is a working area and is cleared between drops, so a photo URL has
          a limited life. Push to Shopify before it rotates — after that Shopify holds
          its own copy and the link no longer matters.
        </p>
      </div>

      {share.items === null ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">The photo share did not answer.</p>
          <p className="mt-1 text-muted-foreground">{share.error}</p>
          <p className="mt-2 text-muted-foreground">
            Check with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              npx dotenv -e .env.local -- npx tsx scripts/vintage/check-sftp.ts
            </code>
            .
          </p>
        </div>
      ) : (
        <VintageDropSheet items={share.items} />
      )}
    </main>
  );
}
