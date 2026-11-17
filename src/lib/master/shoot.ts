// Shoot planning: which products of a season still need photography, and
// whether there is stock to shoot them from.
//
// Media is counted in BOTH places it can live, and on Shopify in both places a
// product keeps it: the product gallery, and for unisex products the
// custom.men_images / custom.women_images metafields (a unisex carry-over can
// have an empty gallery and all its photography in those two lists).
//
// Origo holds what was uploaded for the season (all of FW26's new photography
// went in as Blob media), but 83 of FW26's 119 carry-overs have nothing in
// Origo and their images only exist on Shopify — counting Origo alone would put
// every one of them on the shot list.
//
// Stock comes from Loom: on hand in the warehouse and every store. Shopify's
// inventory only covers what is listed online, so it read a product that is not
// on Shopify yet as having nothing — 7 of FW26's had stock all along.
//
// Read-only against Shopify and Loom. The only writes are people's own: the
// plan and note (SeasonEntry.shootStatus / shootNote), which override what is
// derived here; the prepared tick; and products added to the shot list by hand
// from outside the season (ShootAddition).
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { loomStockFor, type LoomStock } from "@/lib/loom/stock";
import type { ShootStatus } from "@/generated/prisma/client";
import { bucketFor, isOnShotList, type ShootBucket } from "@/lib/shoot-plan";

export type { ShootBucket };

export interface ShootRow {
  /** The SeasonEntry id, or for a product added by hand the ShootAddition id. */
  entryId: string;
  /** "added": not in this season, put on the shot list by hand. */
  kind: "entry" | "added";
  colorwayId: string;
  sku: string;
  styleName: string;
  colour: string;
  brand: string;
  category: string;
  gender: string | null;
  drop: string | null;
  /** ADDED: not in this season; on the shot list because someone put it there. */
  origin: "NEW" | "CARRYOVER" | "ADDED";
  /** For an added product, the latest season it belongs to. */
  fromSeason: string | null;
  cancelled: boolean;
  approved: boolean;
  origo: { count: number; images: string[]; men: number; women: number };
  shopify: {
    adminUrl: string | null;
    status: string | null;
    /** Product gallery only. */
    mediaCount: number;
    /** custom.men_images / custom.women_images (unisex). */
    men: number;
    women: number;
    /** Gallery first, then men, then women images. */
    images: string[];
  } | null;
  /** On hand in Loom, warehouse and stores together; null when not in Loom or Loom could not be read. */
  stock: number | null;
  /** The split behind `stock`; null with it. */
  stockDetail: LoomStock | null;
  hasMedia: boolean;
  bucket: ShootBucket;
  /** Why a product without media is not being shot. Null when nothing blocks it. */
  reason: string | null;
  plan: ShootStatus | null;
  note: string | null;
  planUpdatedAt: string | null;
  planUpdatedBy: string | null;
  /** Ticked off as pulled and ready for the shoot. Stays on the shot list. */
  prepared: boolean;
  preparedAt: string | null;
  preparedBy: string | null;
  /** On the shot list — the planner's rule, or a person's decision. */
  onShotList: boolean;
}

export interface ShootBoard {
  season: string;
  rows: ShootRow[];
  /** Set when Shopify could not be read in full; Shopify media and status are then partial. */
  shopifyError: string | null;
  /** Set when Loom could not be read; stock is then unknown throughout. */
  loomError: string | null;
}

const PRODUCTS_QUERY = `
  query ShootProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        mediaCount { count }
        media(first: 6) {
          nodes { preview { image { url(transform: { maxWidth: 400 }) } } }
        }
        men: metafield(namespace: "custom", key: "men_images") { ...UnisexImages }
        women: metafield(namespace: "custom", key: "women_images") { ...UnisexImages }
      }
    }
  }
  fragment UnisexImages on Metafield {
    value
    references(first: 6) {
      nodes { ... on MediaImage { image { url(transform: { maxWidth: 400 }) } } }
    }
  }
`;

interface UnisexMetafield {
  /** JSON list of file GIDs; its length is the image count. */
  value: string;
  references: { nodes: { image?: { url: string } | null }[] } | null;
}

function unisexImages(m: UnisexMetafield | null | undefined): { count: number; images: string[] } {
  if (!m) return { count: 0, images: [] };
  let count = 0;
  try {
    const ids = JSON.parse(m.value);
    count = Array.isArray(ids) ? ids.length : 0;
  } catch {
    count = 0;
  }
  const images = (m.references?.nodes ?? []).map((n) => n.image?.url).filter((u): u is string => !!u);
  return { count: Math.max(count, images.length), images };
}

interface ShopifyProduct {
  id: string;
  status: string;
  mediaCount: { count: number } | null;
  media: { nodes: { preview: { image: { url: string } | null } | null }[] };
  men: UnisexMetafield | null;
  women: UnisexMetafield | null;
}

// 25 products × (6 media + 2 × 6 metafield references) stays well under the
// 1,000-point query cost.
const BATCH = 25;

async function readShopify(gids: string[]): Promise<{ byId: Map<string, ShopifyProduct>; error: string | null }> {
  const byId = new Map<string, ShopifyProduct>();
  const failures: string[] = [];
  for (let i = 0; i < gids.length; i += BATCH) {
    const ids = gids.slice(i, i + BATCH);
    try {
      const data = await shopifyGraphQL<{ nodes: (ShopifyProduct | null)[] }>(PRODUCTS_QUERY, { ids });
      for (const n of data.nodes) if (n?.id) byId.set(n.id, n);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  const error = failures.length
    ? `Shopify could not be read for ${failures.length} of ${Math.ceil(gids.length / BATCH)} batches (${failures[0]}). Shopify images and status are missing for those products.`
    : null;
  return { byId, error };
}

/** Why a product without media is not ready to shoot, most decisive first. */
function blockReason(r: {
  origin: "NEW" | "CARRYOVER" | "ADDED";
  cancelled: boolean;
  approved: boolean;
  inLoom: boolean;
  stock: number | null;
}): string | null {
  if (r.cancelled) return "Cancelled";
  // Carry-overs are not re-approved each season (101 of FW26's are unapproved),
  // so approval only means something for a new product.
  if (r.origin === "NEW" && !r.approved) return "Not approved for production";
  if (!r.inLoom) return "Not in Loom";
  if (r.stock == null) return "Stock unknown";
  if (r.stock <= 0) return "No stock yet";
  return null;
}

/** SS26 < FW26 < SS27; anything else (CONTINUITY) sorts first. */
function seasonRank(code: string): number {
  const m = /^(SS|FW)(\d{2})$/.exec(code);
  return m ? Number(m[2]) * 2 + (m[1] === "FW" ? 1 : 0) : -1;
}

const COLORWAY_SELECT = {
  id: true,
  colorwaySku: true,
  name: true,
  vendor: true,
  categoryRef: { select: { name: true } },
  brand: { select: { name: true } },
  style: { select: { styleName: true, gender: true, category: true } },
  media: { select: { url: true, role: true }, orderBy: { position: "asc" } },
  publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
} as const;

/**
 * The season's board. `colorwayIds` narrows it to those products, for the
 * screen to fetch the rows it just added without reading the whole season.
 */
export async function getShootBoard(seasonCode: string, opts: { colorwayIds?: string[] } = {}): Promise<ShootBoard> {
  const only = opts.colorwayIds ? { id: { in: opts.colorwayIds } } : {};
  const [seasonEntries, additions] = await Promise.all([
    prisma.seasonEntry.findMany({
      where: {
        season: { code: seasonCode },
        colorway: { archived: false, kind: "MERCHANDISE", ...only },
      },
      select: {
        id: true,
        origin: true,
        cancelled: true,
        approvedForProduction: true,
        drop: true,
        shootStatus: true,
        shootNote: true,
        shootUpdatedAt: true,
        shootUpdatedBy: true,
        shootPreparedAt: true,
        shootPreparedBy: true,
        colorway: { select: COLORWAY_SELECT },
      },
    }),
    prisma.shootAddition.findMany({
      where: { season: { code: seasonCode }, colorway: { archived: false, ...only } },
      select: {
        id: true,
        status: true,
        note: true,
        updatedAt: true,
        updatedBy: true,
        addedBy: true,
        createdAt: true,
        preparedAt: true,
        preparedBy: true,
        colorway: {
          select: {
            ...COLORWAY_SELECT,
            entries: {
              select: { drop: true, season: { select: { code: true } } },
            },
          },
        },
      },
    }),
  ]);

  // One shape for both: a season entry, or a product added by hand. A product
  // added by hand that has since joined the season shows once, as its entry.
  const inSeason = new Set(seasonEntries.map((e) => e.colorway.id));
  const entries = [
    ...seasonEntries.map((e) => ({
      id: e.id,
      kind: "entry" as const,
      origin: e.origin as ShootRow["origin"],
      fromSeason: null as string | null,
      cancelled: e.cancelled,
      approvedForProduction: e.approvedForProduction,
      drop: e.drop,
      shootStatus: e.shootStatus,
      shootNote: e.shootNote,
      shootUpdatedAt: e.shootUpdatedAt,
      shootUpdatedBy: e.shootUpdatedBy,
      shootPreparedAt: e.shootPreparedAt,
      shootPreparedBy: e.shootPreparedBy,
      colorway: e.colorway,
    })),
    ...additions
      .filter((a) => !inSeason.has(a.colorway.id))
      .map((a) => {
        const latest = [...a.colorway.entries].sort((x, y) => seasonRank(y.season.code) - seasonRank(x.season.code))[0];
        return {
          id: a.id,
          kind: "added" as const,
          origin: "ADDED" as const,
          fromSeason: latest?.season.code ?? null,
          cancelled: false,
          approvedForProduction: true,
          drop: null,
          shootStatus: a.status,
          shootNote: a.note,
          shootUpdatedAt: a.updatedAt ?? a.createdAt,
          shootUpdatedBy: a.updatedBy ?? a.addedBy,
          shootPreparedAt: a.preparedAt,
          shootPreparedBy: a.preparedBy,
          colorway: a.colorway,
        };
      }),
  ];

  const gidOf = (e: (typeof entries)[number]) =>
    e.colorway.publications.find((p) => p.externalId)?.externalId ?? null;
  const gids = [...new Set(entries.map(gidOf).filter((g): g is string => !!g))];
  const [{ byId, error }, loom] = await Promise.all([
    gids.length ? readShopify(gids) : { byId: new Map<string, ShopifyProduct>(), error: null },
    loomStockFor(
      seasonCode,
      entries.map((e) => ({ id: e.colorway.id, sku: e.colorway.colorwaySku }))
    ).then(
      (stock) => ({ stock, error: null as string | null }),
      (err) => ({
        stock: new Map<string, LoomStock>(),
        error: `Loom could not be read (${err instanceof Error ? err.message : String(err)}). Stock is unknown for every product.`,
      })
    ),
  ]);

  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");

  const rows: ShootRow[] = entries.map((e) => {
    const cw = e.colorway;
    const gid = gidOf(e);
    const sp = gid ? byId.get(gid) : undefined;
    const origo = {
      count: cw.media.length,
      images: cw.media.slice(0, 6).map((m) => m.url),
      men: cw.media.filter((m) => m.role === "MEN").length,
      women: cw.media.filter((m) => m.role === "WOMEN").length,
    };
    const men = unisexImages(sp?.men);
    const women = unisexImages(sp?.women);
    const shopify = gid
      ? {
          adminUrl: store ? `https://${store}/admin/products/${gid.split("/").pop()}` : null,
          status: sp?.status ?? null,
          mediaCount: sp?.mediaCount?.count ?? 0,
          men: men.count,
          women: women.count,
          images: [
            ...(sp?.media.nodes ?? []).map((n) => n.preview?.image?.url).filter((u): u is string => !!u),
            ...men.images,
            ...women.images,
          ].slice(0, 6),
        }
      : null;
    const stockDetail = loom.stock.get(cw.id) ?? null;
    const stock = stockDetail?.total ?? null;
    // The drop column carries cancellation in practice; the flag is never set.
    const cancelled = e.cancelled || e.drop === "CANCELED";
    const hasMedia = origo.count > 0 || (shopify ? shopify.mediaCount + shopify.men + shopify.women : 0) > 0;
    const bucket = bucketFor(hasMedia, stock, cancelled);
    const reason = hasMedia
      ? null
      : blockReason({ origin: e.origin, cancelled, approved: e.approvedForProduction, inLoom: !!stockDetail || !!loom.error, stock });
    const plan = e.shootStatus;
    const onShotList = isOnShotList(plan, bucket, e.kind === "added");

    return {
      entryId: e.id,
      kind: e.kind,
      colorwayId: cw.id,
      sku: cw.colorwaySku,
      styleName: cw.style.styleName,
      colour: cw.name,
      brand: cw.brand?.name ?? cw.vendor ?? "",
      category: cw.categoryRef?.name ?? cw.style.category,
      gender: cw.style.gender,
      drop: e.drop,
      origin: e.origin,
      fromSeason: e.fromSeason,
      cancelled,
      approved: e.approvedForProduction,
      origo,
      shopify,
      stock,
      stockDetail,
      hasMedia,
      bucket,
      reason,
      plan,
      note: e.shootNote,
      planUpdatedAt: e.shootUpdatedAt?.toISOString() ?? null,
      planUpdatedBy: e.shootUpdatedBy,
      prepared: !!e.shootPreparedAt,
      preparedAt: e.shootPreparedAt?.toISOString() ?? null,
      preparedBy: e.shootPreparedBy,
      onShotList,
    };
  });

  rows.sort(
    (a, b) =>
      (a.drop ?? "~").localeCompare(b.drop ?? "~") ||
      a.styleName.localeCompare(b.styleName) ||
      a.colour.localeCompare(b.colour)
  );

  return { season: seasonCode, rows, shopifyError: error, loomError: loom.error };
}

export const SHOOT_STATUSES: ShootStatus[] = ["SHOOT", "BOOKED", "SHOT", "SKIP"];

export type ShootRowKind = ShootRow["kind"];

export async function setShootPlan(
  kind: ShootRowKind,
  id: string,
  plan: { status: ShootStatus | null; note: string | null },
  by: string | null
) {
  const status = plan.status;
  const note = plan.note?.trim() || null;
  const at = new Date();
  if (kind === "added") {
    const a = await prisma.shootAddition.update({
      where: { id },
      data: { status, note, updatedAt: at, updatedBy: by },
      select: { status: true, note: true, updatedAt: true, updatedBy: true },
    });
    return { shootStatus: a.status, shootNote: a.note, shootUpdatedAt: a.updatedAt, shootUpdatedBy: a.updatedBy };
  }
  return prisma.seasonEntry.update({
    where: { id },
    data: { shootStatus: status, shootNote: note, shootUpdatedAt: at, shootUpdatedBy: by },
    select: { shootStatus: true, shootNote: true, shootUpdatedAt: true, shootUpdatedBy: true },
  });
}

/** Tick a product off as prepared for the shoot, or untick it. */
export async function setShootPrepared(kind: ShootRowKind, id: string, prepared: boolean, by: string | null) {
  const at = prepared ? new Date() : null;
  const who = prepared ? by : null;
  if (kind === "added") {
    await prisma.shootAddition.update({ where: { id }, data: { preparedAt: at, preparedBy: who } });
  } else {
    await prisma.seasonEntry.update({ where: { id }, data: { shootPreparedAt: at, shootPreparedBy: who } });
  }
  return { preparedAt: at?.toISOString() ?? null, preparedBy: who };
}

/**
 * Put products on a season's shot list by hand, by colourway id or SKU. A
 * product in the season is marked Shoot on its entry; one outside it gets a
 * ShootAddition. Already on the list (marked Shoot or Booked, or added
 * before) is left alone. Returns the colourways whose rows changed.
 */
export async function addToShotList(
  seasonCode: string,
  input: { ids?: string[]; skus?: string[] },
  by: string | null
) {
  const season = await prisma.season.findUnique({ where: { code: seasonCode }, select: { id: true } });
  if (!season) throw new Error(`No season ${seasonCode}`);
  const skus = [...new Set((input.skus ?? []).map((x) => x.trim()).filter(Boolean))];
  const ids = [...new Set((input.ids ?? []).filter(Boolean))];
  const found = await prisma.colorway.findMany({
    where: {
      archived: false,
      kind: "MERCHANDISE",
      OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(skus.length ? [{ colorwaySku: { in: skus, mode: "insensitive" as const } }] : [])],
    },
    select: { id: true, colorwaySku: true },
  });
  const foundSkus = new Set(found.map((c) => c.colorwaySku.toUpperCase()));
  const notFound = skus.filter((x) => !foundSkus.has(x.toUpperCase()));
  const cwIds = found.map((c) => c.id);

  const [entries, existing] = await Promise.all([
    prisma.seasonEntry.findMany({
      where: { seasonId: season.id, colorwayId: { in: cwIds } },
      select: { id: true, colorwayId: true, shootStatus: true },
    }),
    prisma.shootAddition.findMany({
      where: { seasonId: season.id, colorwayId: { in: cwIds } },
      select: { id: true, colorwayId: true, status: true },
    }),
  ]);
  const entryOf = new Map(entries.map((e) => [e.colorwayId, e]));
  const additionOf = new Map(existing.map((a) => [a.colorwayId, a]));
  const at = new Date();
  const changed: string[] = [];
  let already = 0;
  for (const id of cwIds) {
    const e = entryOf.get(id);
    const a = additionOf.get(id);
    if (e) {
      if (e.shootStatus === "SHOOT" || e.shootStatus === "BOOKED") {
        already++;
        continue;
      }
      await prisma.seasonEntry.update({
        where: { id: e.id },
        data: { shootStatus: "SHOOT", shootUpdatedAt: at, shootUpdatedBy: by },
      });
    } else if (a) {
      // Added before: back on the list if it had been set Shot or Skip.
      if (a.status !== "SHOT" && a.status !== "SKIP") {
        already++;
        continue;
      }
      await prisma.shootAddition.update({ where: { id: a.id }, data: { status: null, updatedAt: at, updatedBy: by } });
    } else {
      await prisma.shootAddition.create({ data: { seasonId: season.id, colorwayId: id, addedBy: by } });
    }
    changed.push(id);
  }
  return { added: changed.length, already, notFound, colorwayIds: changed };
}

/** Take a hand-added product off the season's shot list. */
export async function removeShootAddition(id: string) {
  await prisma.shootAddition.delete({ where: { id } });
}
