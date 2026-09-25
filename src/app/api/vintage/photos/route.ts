import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  listVintagePhotos,
  matchPhotosToItems,
  VintagePhotoError,
} from "@/lib/vintage/photos";
import { vintageSku } from "@/lib/master/vintage-create";

// The sFTP client needs Node, not Edge, and a cold share listing is not fast.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/vintage/photos
//
// What the shoot has uploaded, and which of it is already in the master. This
// is the screen's starting point rather than a blank form: the share is the
// record of what was photographed, so the drop sheet is seeded FROM it and the
// operator fills in the words. That inverts the spreadsheet, where a row was
// typed first and the photo was hoped for.
export async function GET() {
  try {
    const byItem = await listVintagePhotos();
    const itemNumbers = [...byItem.keys()].sort((a, b) => Number(a) - Number(b));

    // Which already have a colorway. `matchPhotosToItems` answers the reverse
    // question (rows without photos); here the rows are the whole share.
    const existing = await prisma.colorway.findMany({
      where: { colorwaySku: { in: itemNumbers.map(vintageSku) } },
      select: { colorwaySku: true, name: true, id: true },
    });
    const bySku = new Map(existing.map((e) => [e.colorwaySku, e]));

    const match = matchPhotosToItems(itemNumbers, byItem);

    return NextResponse.json({
      ok: true,
      items: itemNumbers.map((n) => {
        const found = bySku.get(vintageSku(n));
        return {
          itemNumber: n,
          photos: (byItem.get(n) ?? []).map((p) => ({
            url: p.url,
            index: p.index,
            filename: p.filename,
          })),
          // An item already in the master is shown but not offered for entry —
          // re-entering it would collide on the SKU.
          existing: found ? { id: found.id, name: found.name } : null,
          missingBasePhoto: match.missingBasePhoto.includes(n),
        };
      }),
      counts: {
        onShare: itemNumbers.length,
        alreadyEntered: existing.length,
        newToEnter: itemNumbers.length - existing.length,
        missingBasePhoto: match.missingBasePhoto.length,
      },
    });
  } catch (err) {
    if (err instanceof VintagePhotoError)
      return NextResponse.json({ error: err.message }, { status: 502 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read the photo share" },
      { status: 500 }
    );
  }
}
