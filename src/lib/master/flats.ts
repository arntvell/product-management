// Flats: a standing list of products that need a flat-lay, and the upload
// that closes each one.
//
// Admins and Product managers queue products; the Vintage photographer, who
// shoots the flats, works the list. An upload is the colourway's FLAT image in
// Origo and `custom.flat` on Shopify at once, so a flat is live on the product
// page the moment it is uploaded — no push in between.
//
// Only `custom.flat` is written on Shopify. A full push also puts a unisex
// product's flat in its gallery (publish.ts); this does not touch the gallery,
// so a unisex product picks that up at its next push.
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { METAFIELDS_SET_MUTATION } from "@/lib/shopify/mutations";
import { loomGet } from "@/lib/loom/client";
import { deleteMedia } from "@/lib/master/media";
import { ensureShopifyFiles } from "@/lib/master/shopify-media";

export interface FlatStock {
  total: number;
  warehouse: number;
  stores: number;
  byLocation: { location: string; onHand: number }[];
}

export interface FlatRow {
  id: string;
  colorwayId: string;
  sku: string;
  product: string;
  gender: string;
  note: string | null;
  requestedBy: string | null;
  createdAt: string;
  uploadedAt: string | null;
  uploadedBy: string | null;
  doneAt: string | null;
  shopifyError: string | null;
  /** A picture of the garment, to know which one to fetch. */
  thumb: string | null;
  /** The flat as uploaded, once there is one. */
  flat: string | null;
  shopifyAdminUrl: string | null;
  shopifyStatus: string | null;
  /** Null when Loom could not be read or does not hold the product. */
  stock: FlatStock | null;
}

const DONE_SHOWN_DAYS = 30;

interface LoomRow {
  colorway_sku: string;
  variants: { stock?: { location: string; source: string; on_hand: number | null }[] }[];
}

/** On hand per location, looked up by SKU — the list spans seasons. */
async function stockBySku(skus: string[]): Promise<Map<string, FlatStock>> {
  const out = new Map<string, FlatStock>();
  for (let i = 0; i < skus.length; i += 10) {
    await Promise.all(
      skus.slice(i, i + 10).map(async (sku) => {
        try {
          const page = await loomGet<{ rows: LoomRow[] }>("products", { sku });
          const row = page.rows.find((r) => r.colorway_sku.toUpperCase() === sku.toUpperCase());
          if (!row) return;
          const by = new Map<string, number>();
          let warehouse = 0;
          let stores = 0;
          for (const v of row.variants)
            for (const s of v.stock ?? []) {
              const n = Math.max(s.on_hand ?? 0, 0);
              if (!n) continue;
              by.set(s.location, (by.get(s.location) ?? 0) + n);
              if (s.source === "pio") warehouse += n;
              else stores += n;
            }
          out.set(sku, {
            total: warehouse + stores,
            warehouse,
            stores,
            byLocation: [...by].map(([location, onHand]) => ({ location, onHand })).sort((a, b) => b.onHand - a.onHand),
          });
        } catch {
          /* stock unknown for this one; the row says so */
        }
      })
    );
  }
  return out;
}

const SHOPIFY_QUERY = `
  query FlatProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        featuredMedia { preview { image { url(transform: { maxWidth: 300 }) } } }
        flat: metafield(namespace: "custom", key: "flat") {
          reference { ... on MediaImage { image { url(transform: { maxWidth: 300 }) } } }
        }
      }
    }
  }
`;

interface ShopifyNode {
  id: string;
  status: string;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  flat: { reference: { image?: { url: string } | null } | null } | null;
}

export async function getFlatBoard(): Promise<{ open: FlatRow[]; done: FlatRow[] }> {
  const since = new Date(Date.now() - DONE_SHOWN_DAYS * 864e5);
  const requests = await prisma.flatRequest.findMany({
    where: { OR: [{ doneAt: null }, { doneAt: { gte: since } }] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      note: true,
      requestedBy: true,
      createdAt: true,
      mediaId: true,
      uploadedAt: true,
      uploadedBy: true,
      doneAt: true,
      shopifyError: true,
      colorway: {
        select: {
          id: true,
          colorwaySku: true,
          name: true,
          style: { select: { styleName: true, gender: true, unisex: true } },
          media: { select: { id: true, url: true, role: true }, orderBy: { position: "asc" } },
          publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
        },
      },
    },
  });

  const gidOf = (r: (typeof requests)[number]) => r.colorway.publications.find((p) => p.externalId)?.externalId ?? null;
  const gids = [...new Set(requests.map(gidOf).filter((g): g is string => !!g))];
  const shop = new Map<string, ShopifyNode>();
  for (let i = 0; i < gids.length; i += 50) {
    try {
      const d = await shopifyGraphQL<{ nodes: (ShopifyNode | null)[] }>(SHOPIFY_QUERY, { ids: gids.slice(i, i + 50) });
      for (const n of d.nodes) if (n?.id) shop.set(n.id, n);
    } catch {
      /* thumbnails from Shopify missing for this batch */
    }
  }
  const openSkus = requests.filter((r) => !r.doneAt).map((r) => r.colorway.colorwaySku);
  const stock = await stockBySku([...new Set(openSkus)]);
  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

  const rows: FlatRow[] = requests.map((r) => {
    const cw = r.colorway;
    const gid = gidOf(r);
    const sp = gid ? shop.get(gid) : undefined;
    const uploaded = r.mediaId ? cw.media.find((m) => m.id === r.mediaId)?.url ?? null : null;
    return {
      id: r.id,
      colorwayId: cw.id,
      sku: cw.colorwaySku,
      product: cw.name.startsWith(cw.style.styleName) ? cw.name : `${cw.style.styleName} ${cw.name}`,
      gender: cw.style.unisex ? "Unisex" : cw.style.gender === "men" ? "Men" : cw.style.gender === "women" ? "Women" : "",
      note: r.note,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt.toISOString(),
      uploadedAt: r.uploadedAt?.toISOString() ?? null,
      uploadedBy: r.uploadedBy,
      doneAt: r.doneAt?.toISOString() ?? null,
      shopifyError: r.shopifyError,
      thumb: cw.media.find((m) => m.role !== "FLAT")?.url ?? sp?.featuredMedia?.preview?.image?.url ?? null,
      flat: uploaded ?? sp?.flat?.reference?.image?.url ?? cw.media.find((m) => m.role === "FLAT")?.url ?? null,
      shopifyAdminUrl: gid && store ? `https://${store}/admin/products/${gid.split("/").pop()}` : null,
      shopifyStatus: sp?.status ?? null,
      stock: stock.get(cw.colorwaySku) ?? null,
    };
  });
  return {
    open: rows.filter((r) => !r.doneAt),
    done: rows.filter((r) => r.doneAt).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")),
  };
}

/** Livid products an admin can queue: the search list on the page. */
export async function flatCandidates(): Promise<{ id: string; label: string }[]> {
  const cws = await prisma.colorway.findMany({
    where: { archived: false, kind: "MERCHANDISE", brand: { isLivid: true } },
    select: { id: true, colorwaySku: true, name: true, style: { select: { styleName: true } } },
  });
  return cws
    .map((c) => ({
      id: c.id,
      label: `${c.name.startsWith(c.style.styleName) ? c.name : `${c.style.styleName} ${c.name}`} · ${c.colorwaySku}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Queue products, by colourway id or SKU. A product already on the open list
 * is left as it is rather than queued twice.
 */
export async function addFlatRequests(input: { ids?: string[]; skus?: string[]; note?: string | null }, by: string | null) {
  const skus = [...new Set((input.skus ?? []).map((s) => s.trim()).filter(Boolean))];
  const bySku = skus.length
    ? await prisma.colorway.findMany({
        where: { colorwaySku: { in: skus, mode: "insensitive" } },
        select: { id: true, colorwaySku: true },
      })
    : [];
  const found = new Set(bySku.map((c) => c.colorwaySku.toUpperCase()));
  const notFound = skus.filter((s) => !found.has(s.toUpperCase()));
  const ids = [...new Set([...(input.ids ?? []), ...bySku.map((c) => c.id)])];
  const already = await prisma.flatRequest.findMany({
    where: { colorwayId: { in: ids }, doneAt: null },
    select: { colorwayId: true },
  });
  const skip = new Set(already.map((a) => a.colorwayId));
  const toAdd = ids.filter((id) => !skip.has(id));
  if (toAdd.length)
    await prisma.flatRequest.createMany({
      data: toAdd.map((colorwayId) => ({ colorwayId, note: input.note?.trim() || null, requestedBy: by })),
    });
  return { added: toAdd.length, alreadyOpen: skip.size, notFound };
}

export async function removeFlatRequest(id: string) {
  await prisma.flatRequest.deleteMany({ where: { id, doneAt: null } });
}

export async function setFlatNote(id: string, note: string | null) {
  await prisma.flatRequest.update({ where: { id }, data: { note: note?.trim() || null } });
}

/** The open request an upload is for, or null — what the Vintage routes check first. */
export async function openFlatRequest(id: string) {
  return prisma.flatRequest.findFirst({ where: { id, doneAt: null }, select: { id: true, colorwayId: true } });
}

/**
 * Record an uploaded flat and send it to Shopify.
 *
 * A re-shoot replaces: the colourway's earlier FLAT images go, so Origo holds
 * one flat and a later push cannot send the old one back.
 */
export async function recordFlatUpload(
  requestId: string,
  blob: { url: string; pathname: string },
  by: string | null
) {
  const req = await openFlatRequest(requestId);
  if (!req) throw new Error("This product is no longer on the flats list.");
  const old = await prisma.mediaAsset.findMany({
    where: { colorwayId: req.colorwayId, role: "FLAT" },
    select: { id: true },
  });
  for (const o of old) await deleteMedia(o.id);
  const max = await prisma.mediaAsset.aggregate({ where: { colorwayId: req.colorwayId }, _max: { position: true } });
  const media = await prisma.mediaAsset.create({
    data: {
      colorwayId: req.colorwayId,
      url: blob.url,
      blobPathname: blob.pathname,
      source: "BLOB",
      role: "FLAT",
      position: (max._max.position ?? -1) + 1,
    },
  });
  await prisma.flatRequest.update({
    where: { id: requestId },
    data: { mediaId: media.id, uploadedAt: new Date(), uploadedBy: by, shopifyError: null },
  });
  return sendFlatToShopify(requestId);
}

/**
 * Point `custom.flat` at the uploaded flat. Done when Shopify has it, or when
 * the product is not on Shopify at all (its first push carries the flat).
 * A failure is kept on the request, which stays open for a retry.
 */
export async function sendFlatToShopify(requestId: string): Promise<{ done: boolean; error: string | null }> {
  const req = await prisma.flatRequest.findUnique({
    where: { id: requestId },
    select: {
      mediaId: true,
      colorway: {
        select: {
          id: true,
          media: { select: { id: true, url: true, shopifyMediaId: true } },
          publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
        },
      },
    },
  });
  if (!req?.mediaId) throw new Error("Nothing uploaded yet.");
  const media = req.colorway.media.find((m) => m.id === req.mediaId);
  if (!media) throw new Error("The uploaded flat is gone — upload it again.");
  const gid = req.colorway.publications.find((p) => p.externalId)?.externalId;

  const finish = (data: { shopifyFileId?: string | null; error: string | null }) =>
    prisma.flatRequest.update({
      where: { id: requestId },
      data: data.error
        ? { shopifyError: data.error }
        : { doneAt: new Date(), shopifyError: null, shopifyFileId: data.shopifyFileId ?? null },
    });

  if (!gid) {
    await finish({ error: null });
    return { done: true, error: null };
  }
  const warnings: string[] = [];
  const known = new Map(media.shopifyMediaId ? [[media.url, media.shopifyMediaId]] : []);
  const files = await ensureShopifyFiles(req.colorway.id, [media.url], known, warnings);
  const fileId = files.get(media.url);
  if (!fileId) {
    const error = warnings[0] ?? "Shopify did not accept the image.";
    await finish({ error });
    return { done: false, error };
  }
  try {
    const r = await shopifyGraphQL<{ metafieldsSet: { userErrors: { message: string }[] } }>(METAFIELDS_SET_MUTATION, {
      metafields: [{ ownerId: gid, namespace: "custom", key: "flat", type: "file_reference", value: fileId }],
    });
    const errs = r.metafieldsSet?.userErrors ?? [];
    if (errs.length) throw new Error(errs.map((e) => e.message).join(", "));
  } catch (err) {
    const error = `Uploaded, but Shopify's flat was not set: ${err instanceof Error ? err.message : String(err)}`;
    await finish({ error });
    return { done: false, error };
  }
  await finish({ shopifyFileId: fileId, error: null });
  return { done: true, error: null };
}
