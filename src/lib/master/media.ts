// Media manager backend (Phase 2). Master-uploaded media lives in Vercel Blob
// (public, per plan). External images (Shopify CDN / Threadflow) are referenced
// in place and can be "adopted" into Blob on demand or before a Loom push.
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { fetchImage } from "@/lib/threadflow/client";

// Pass the store token explicitly — in a Vercel-linked project the SDK would
// otherwise prefer OIDC auto-detection, which isn't enabled for local dev.
const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN;

export async function listColorwayMedia(colorwayId: string) {
  return prisma.mediaAsset.findMany({
    where: { colorwayId },
    orderBy: { position: "asc" },
  });
}

/** Record a MediaAsset for a blob the client already uploaded. */
export async function createBlobMedia(input: {
  colorwayId: string;
  url: string;
  blobPathname: string;
  alt?: string | null;
}) {
  const max = await prisma.mediaAsset.aggregate({
    where: { colorwayId: input.colorwayId },
    _max: { position: true },
  });
  return prisma.mediaAsset.create({
    data: {
      colorwayId: input.colorwayId,
      url: input.url,
      blobPathname: input.blobPathname,
      source: "BLOB",
      alt: input.alt ?? null,
      position: (max._max.position ?? -1) + 1,
    },
  });
}

export async function reorderMedia(
  colorwayId: string,
  orderedIds: string[]
): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.mediaAsset.updateMany({
        where: { id, colorwayId },
        data: { position: index },
      })
    )
  );
}

export async function deleteMedia(id: string): Promise<void> {
  const m = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!m) return;
  // Only delete the underlying object if we own it in Blob.
  if (m.source === "BLOB" && m.blobPathname) {
    try {
      await del(m.url, { token: blobToken() });
    } catch {
      /* object already gone — proceed to delete the row */
    }
  }
  await prisma.mediaAsset.delete({ where: { id } });
}

/**
 * Delete Blob objects owned by the given colorways, before the colorway rows
 * (and their MediaAsset rows) are cascade-deleted — otherwise the Blob files
 * would be orphaned.
 */
export async function purgeColorwayBlobs(colorwayIds: string[]): Promise<void> {
  if (colorwayIds.length === 0) return;
  const owned = await prisma.mediaAsset.findMany({
    where: { colorwayId: { in: colorwayIds }, source: "BLOB" },
    select: { url: true },
  });
  await Promise.all(
    owned.map((m) =>
      del(m.url, { token: blobToken() }).catch(() => {
        /* object already gone */
      })
    )
  );
}

/** Fetch an external image's bytes and re-host it in Blob (master owns it). */
export async function adoptMedia(id: string) {
  const m = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!m) throw new Error("Media not found");
  if (m.source === "BLOB") return m; // already owned

  let bytes: ArrayBuffer;
  let contentType: string;
  if (m.source === "THREADFLOW") {
    const img = await fetchImage(m.url);
    if (!img) throw new Error("Could not fetch Threadflow image");
    bytes = img.body;
    contentType = img.contentType;
  } else {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
    bytes = await res.arrayBuffer();
    contentType = res.headers.get("content-type") ?? "image/jpeg";
  }

  const ext = (contentType.split("/")[1] ?? "jpg").split(";")[0];
  const blob = await put(
    `colorways/${m.colorwayId}/${m.id}.${ext}`,
    Buffer.from(bytes),
    { access: "public", contentType, addRandomSuffix: true, token: blobToken() }
  );

  return prisma.mediaAsset.update({
    where: { id },
    data: { url: blob.url, source: "BLOB", blobPathname: blob.pathname },
  });
}
