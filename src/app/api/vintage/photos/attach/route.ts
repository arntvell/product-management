import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listVintagePhotos, matchPhotosToItems, VintagePhotoError } from "@/lib/vintage/photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/vintage/photos/attach  { drop | colorwayIds[], replace?, dryRun? }
//
// Attach the share's photographs to garments that are already in the master.
//
// This is the normal case, not a repair. The writing is done first and the
// shoot uploads through the day, so a drop is created unphotographed and the
// pictures are matched in afterwards — possibly more than once, as the
// remaining garments are shot.
export async function POST(req: Request) {
  let body: { drop?: string; colorwayIds?: string[]; replace?: boolean; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const where = body.drop?.trim()
    ? { entries: { some: { drop: body.drop.trim() } } }
    : { id: { in: body.colorwayIds ?? [] } };
  if (!body.drop?.trim() && !body.colorwayIds?.length)
    return NextResponse.json({ error: "Pass a drop or colorwayIds" }, { status: 400 });

  const garments = await prisma.colorway.findMany({
    where,
    select: {
      id: true,
      colorwaySku: true,
      vintage: { select: { itemNumber: true } },
      media: { select: { id: true, url: true, shopifyMediaId: true } },
    },
  });
  if (!garments.length) return NextResponse.json({ error: "No garments found" }, { status: 404 });

  let byItem;
  try {
    byItem = await listVintagePhotos();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof VintagePhotoError ? err.message : "Could not read the share" },
      { status: 502 }
    );
  }

  const numberOf = (g: (typeof garments)[number]) =>
    g.vintage?.itemNumber ?? g.colorwaySku.split("-").pop() ?? "";
  const match = matchPhotosToItems(garments.map(numberOf), byItem);

  const plan = garments.map((g) => {
    const n = numberOf(g);
    const urls = match.photos.get(n) ?? [];
    const already = new Set(g.media.map((m) => m.url));
    // A garment whose photos are already pushed to Shopify keeps them: the
    // cached file GID is what stops a re-push duplicating the upload, and the
    // share rotates, so the URL may be dead while Shopify's copy is not.
    const pushed = g.media.some((m) => m.shopifyMediaId);
    return {
      id: g.id,
      itemNumber: n,
      onShare: urls.length,
      have: g.media.length,
      toAdd: urls.filter((u) => !already.has(u)),
      blockedByPush: pushed && body.replace === true,
    };
  });

  const willAdd = plan.filter((p) => p.toAdd.length && !p.blockedByPush);
  const stillWaiting = plan.filter((p) => !p.onShare).map((p) => p.itemNumber);

  if (body.dryRun)
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldAttach: willAdd.reduce((n, p) => n + p.toAdd.length, 0),
      garments: willAdd.length,
      stillWaiting,
      photosWithoutRows: match.photosWithoutRows.length,
    });

  let attached = 0;
  for (const p of willAdd) {
    if (body.replace) {
      await prisma.mediaAsset.deleteMany({ where: { colorwayId: p.id, source: "EXTERNAL" } });
    }
    const start = body.replace ? 0 : p.have;
    // Written in one go per garment so position follows the share's numeric
    // order — position 0 is the storefront's featured image, and the old
    // import trusting directory order is why 13762 went live 1, 3, 2.
    await prisma.mediaAsset.createMany({
      data: p.toAdd.map((url, i) => ({
        colorwayId: p.id,
        url,
        source: "EXTERNAL" as const,
        role: "GALLERY" as const,
        blobPathname: null,
        position: start + i,
      })),
    });
    attached += p.toAdd.length;
  }

  return NextResponse.json({
    ok: true,
    attached,
    garments: willAdd.length,
    stillWaiting,
    // Photographed but not written up — the check the spreadsheet could never do.
    photosWithoutRows: match.photosWithoutRows,
  });
}
