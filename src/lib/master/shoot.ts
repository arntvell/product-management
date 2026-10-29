// Shoot planning: which products of a season still need photography, and
// whether there is stock to shoot them from.
//
// Media is counted in BOTH places it can live. Origo holds what was uploaded
// for the season (all of FW26's new photography went in as Blob media), but 83
// of FW26's 119 carry-overs have nothing in Origo and their images only exist
// on Shopify — counting Origo alone would put every one of them on the shot
// list. Stock is Shopify's totalInventory, which sums every location, the
// warehouse included.
//
// Read-only against Shopify. The only write is the person's own decision
// (SeasonEntry.shootStatus / shootNote), which overrides what is derived here.
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import type { ShootStatus } from "@/generated/prisma/client";
import { bucketFor, isOnShotList, type ShootBucket } from "@/lib/shoot-plan";

export type { ShootBucket };

export interface ShootRow {
  entryId: string;
  colorwayId: string;
  sku: string;
  styleName: string;
  colour: string;
  brand: string;
  category: string;
  gender: string | null;
  drop: string | null;
  origin: "NEW" | "CARRYOVER";
  cancelled: boolean;
  approved: boolean;
  origo: { count: number; images: string[]; men: number; women: number };
  shopify: {
    adminUrl: string | null;
    status: string | null;
    mediaCount: number;
    images: string[];
  } | null;
  /** Shopify's totalInventory; null when it could not be read. */
  stock: number | null;
  hasMedia: boolean;
  bucket: ShootBucket;
  /** Why a product without media is not being shot. Null when nothing blocks it. */
  reason: string | null;
  plan: ShootStatus | null;
  note: string | null;
  planUpdatedAt: string | null;
  planUpdatedBy: string | null;
  /** On the shot list — the planner's rule, or a person's decision. */
  onShotList: boolean;
}

export interface ShootBoard {
  season: string;
  rows: ShootRow[];
  /** Set when Shopify could not be read in full; stock and Shopify media are then partial. */
  shopifyError: string | null;
}

const PRODUCTS_QUERY = `
  query ShootProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        totalInventory
        mediaCount { count }
        media(first: 6) {
          nodes { preview { image { url(transform: { maxWidth: 400 }) } } }
        }
      }
    }
  }
`;

interface ShopifyProduct {
  id: string;
  status: string;
  totalInventory: number | null;
  mediaCount: { count: number } | null;
  media: { nodes: { preview: { image: { url: string } | null } | null }[] };
}

// 50 products × 6 media stays well under the 1,000-point query cost.
const BATCH = 50;

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
    ? `Shopify could not be read for ${failures.length} of ${Math.ceil(gids.length / BATCH)} batches (${failures[0]}). Stock and Shopify images are missing for those products.`
    : null;
  return { byId, error };
}

/** Why a product without media is not ready to shoot, most decisive first. */
function blockReason(r: {
  origin: "NEW" | "CARRYOVER";
  cancelled: boolean;
  approved: boolean;
  onShopify: boolean;
  stock: number | null;
}): string | null {
  if (r.cancelled) return "Cancelled";
  // Carry-overs are not re-approved each season (101 of FW26's are unapproved),
  // so approval only means something for a new product.
  if (r.origin === "NEW" && !r.approved) return "Not approved for production";
  if (!r.onShopify) return "Not on Shopify yet";
  if (r.stock == null) return "Stock unknown";
  if (r.stock <= 0) return "No stock yet";
  return null;
}

export async function getShootBoard(seasonCode: string): Promise<ShootBoard> {
  const entries = await prisma.seasonEntry.findMany({
    where: {
      season: { code: seasonCode },
      colorway: { archived: false, kind: "MERCHANDISE" },
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
      colorway: {
        select: {
          id: true,
          colorwaySku: true,
          name: true,
          vendor: true,
          categoryRef: { select: { name: true } },
          brand: { select: { name: true } },
          style: { select: { styleName: true, gender: true, category: true } },
          media: { select: { url: true, role: true }, orderBy: { position: "asc" } },
          publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
        },
      },
    },
  });

  const gidOf = (e: (typeof entries)[number]) =>
    e.colorway.publications.find((p) => p.externalId)?.externalId ?? null;
  const gids = [...new Set(entries.map(gidOf).filter((g): g is string => !!g))];
  const { byId, error } = gids.length ? await readShopify(gids) : { byId: new Map<string, ShopifyProduct>(), error: null };

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
    const shopify = gid
      ? {
          adminUrl: store ? `https://${store}/admin/products/${gid.split("/").pop()}` : null,
          status: sp?.status ?? null,
          mediaCount: sp?.mediaCount?.count ?? 0,
          images: (sp?.media.nodes ?? []).map((n) => n.preview?.image?.url).filter((u): u is string => !!u),
        }
      : null;
    const stock = sp ? (sp.totalInventory ?? 0) : null;
    // The drop column carries cancellation in practice; the flag is never set.
    const cancelled = e.cancelled || e.drop === "CANCELED";
    const hasMedia = origo.count > 0 || (shopify?.mediaCount ?? 0) > 0;
    const bucket = bucketFor(hasMedia, stock, cancelled);
    const reason = hasMedia
      ? null
      : blockReason({ origin: e.origin, cancelled, approved: e.approvedForProduction, onShopify: !!gid, stock });
    const plan = e.shootStatus;
    const onShotList = isOnShotList(plan, bucket);

    return {
      entryId: e.id,
      colorwayId: cw.id,
      sku: cw.colorwaySku,
      styleName: cw.style.styleName,
      colour: cw.name,
      brand: cw.brand?.name ?? cw.vendor ?? "",
      category: cw.categoryRef?.name ?? cw.style.category,
      gender: cw.style.gender,
      drop: e.drop,
      origin: e.origin,
      cancelled,
      approved: e.approvedForProduction,
      origo,
      shopify,
      stock,
      hasMedia,
      bucket,
      reason,
      plan,
      note: e.shootNote,
      planUpdatedAt: e.shootUpdatedAt?.toISOString() ?? null,
      planUpdatedBy: e.shootUpdatedBy,
      onShotList,
    };
  });

  rows.sort(
    (a, b) =>
      (a.drop ?? "~").localeCompare(b.drop ?? "~") ||
      a.styleName.localeCompare(b.styleName) ||
      a.colour.localeCompare(b.colour)
  );

  return { season: seasonCode, rows, shopifyError: error };
}

export const SHOOT_STATUSES: ShootStatus[] = ["SHOOT", "BOOKED", "SHOT", "SKIP"];

export async function setShootPlan(
  entryId: string,
  plan: { status: ShootStatus | null; note: string | null },
  by: string | null
) {
  return prisma.seasonEntry.update({
    where: { id: entryId },
    data: {
      shootStatus: plan.status,
      shootNote: plan.note?.trim() || null,
      shootUpdatedAt: new Date(),
      shootUpdatedBy: by,
    },
    select: { id: true, shootStatus: true, shootNote: true, shootUpdatedAt: true, shootUpdatedBy: true },
  });
}
