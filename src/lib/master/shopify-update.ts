// Updating a product Shopify already sells: send what changed, nothing else.
//
// pushColorwayToShopify used to answer every update with a declarative
// productSet of the whole colourway. On 2026-10-07 that was measured against
// the shop: 373 of 437 live Livid products differ from the master on fields
// nobody had touched — 365 URLs, 1,537 size prices, 92 products with sizes the
// master lacks, 34 with more images — so editing one field and pushing would
// have rewritten all of them.
//
// The fix is a baseline. ChannelPublication.baseline holds every value the push
// writes, as the master had it when master and shop last agreed (a push, a
// link, or the backfill that froze today's differences). An update sends a key
// only when the master's value has MOVED OFF the baseline — whoever moved it: a
// grid edit, a Threadflow sync, a copy-fields — and skips it when Shopify
// already holds that value. Everything else on the product is left exactly as
// Shopify has it. Each write is a targeted mutation (productUpdate,
// metafieldsSet/Delete, productVariantsBulkUpdate), never productSet, so
// nothing the input omits can be deleted.
//
// What this deliberately does NOT do on a live product:
//   - change the handle (the URL);
//   - delete a size or an image, or add one. New sizes go through Add size,
//     which copies a sibling's sale price and stock policy; image changes are
//     reported, not sent.
//   - unpublish: a live ACTIVE product keeps its status.
//
// Vintage stays on the full push. Its body, inventory and status are generated
// by the master and the drop reveal depends on that path.

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import {
  METAFIELDS_DELETE_MUTATION,
  METAFIELDS_SET_MUTATION,
  PRODUCT_UPDATE_MUTATION,
  PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
} from "@/lib/shopify/mutations";
import { METAFIELD_NAMESPACE } from "@/lib/constants";
import { buildShopifyPreview, getColorwayForPublish } from "./publish";

type PublishColorway = NonNullable<Awaited<ReturnType<typeof getColorwayForPublish>>>;
type Preview = ReturnType<typeof buildShopifyPreview>;

/** Flattened values the push writes. Keys are stable; values are strings. */
export type ShopifySnapshot = Record<string, string>;

const SNAPSHOT_VERSION = "1";

/** Metafields a selective update can write, with the Shopify type each takes. */
const TEXT_METAFIELDS: Record<string, string> = {
  short_description: "multi_line_text_field",
  full_description: "multi_line_text_field",
  details: "multi_line_text_field",
  style_tagline: "multi_line_text_field",
  style_name: "single_line_text_field",
  color_hex: "color",
  care_page: "page_reference",
  fitguide: "page_reference",
  recommended_product_from_collection: "collection_reference",
};
const LIST_REF_METAFIELDS = [
  "same_product",
  "style_with",
  "style_with_unisex_herre",
  "style_with_unisex_dame",
];

const LABELS: Record<string, string> = {
  title: "Title",
  vendor: "Vendor",
  productType: "Product type",
  status: "Status",
  tags: "Tags",
  price: "Price",
  sizes: "Sizes",
  "mf.short_description": "Short description",
  "mf.full_description": "Full description",
  "mf.details": "Details",
  "mf.style_tagline": "Style tagline",
  "mf.style_name": "Style name",
  "mf.color_hex": "Swatch",
  "mf.care_page": "Care page",
  "mf.fitguide": "Fit guide",
  "mf.recommended_product_from_collection": "Recommended collection",
  "mf.model_info": "Model",
  "mf.same_product": "Same product",
  "mf.style_with": "Style with",
  "mf.style_with_unisex_herre": "Style with (herre)",
  "mf.style_with_unisex_dame": "Style with (dame)",
  "media.product": "Images",
  "media.flat": "Flat image",
  "media.men": "Men images",
  "media.women": "Women images",
};

export function labelFor(key: string): string {
  if (key.startsWith("barcode.")) return `Barcode ${key.slice(8)}`;
  return LABELS[key] ?? key;
}

const norm = (v: string | null | undefined) => (v ?? "").replace(/\r\n/g, "\n").trim();

/**
 * Everything the push would write, from the master, as key -> value.
 *
 * Price is one key because the master prices a colourway, not a size; the
 * season it was read under is kept beside it, because the same product carries
 * a different price per season and comparing across seasons would read every
 * product as repriced.
 */
export function shopifySnapshot(cw: PublishColorway, preview: Preview, seasonCode?: string): ShopifySnapshot {
  const s: ShopifySnapshot = { _v: SNAPSHOT_VERSION };
  s.title = norm(preview.product.title);
  s.vendor = norm(preview.product.vendor);
  s.productType = norm(preview.product.productType);
  s.status = preview.product.status;
  s.tags = [...preview.product.tags].map((t) => t.trim()).filter(Boolean).sort().join(", ");

  const mf = new Map(preview.metafields.map((m) => [m.key, m.value]));
  for (const key of Object.keys(TEXT_METAFIELDS)) s[`mf.${key}`] = norm(mf.get(key));
  for (const key of LIST_REF_METAFIELDS) s[`mf.${key}`] = norm(mf.get(key));
  s["mf.model_info"] = norm(cw.modelInfoId);

  s.price = norm(preview.variants.find((v) => v.price)?.price);
  s._priceSeason = seasonCode ?? "";
  s.sizes = preview.variants
    .map((v) => (v.dim2 ? `${v.dim1}/${v.dim2}` : v.size))
    .sort()
    .join(", ");
  for (const v of preview.variants) s[`barcode.${v.sku}`] = norm(v.barcode);

  s["media.product"] = preview.media.join("\n");
  s["media.flat"] = preview.roleMedia.flat.join("\n");
  s["media.men"] = preview.roleMedia.men.join("\n");
  s["media.women"] = preview.roleMedia.women.join("\n");
  return s;
}

/** Record that master and Shopify agree on this colourway, as of now. */
export async function setShopifyBaseline(colorwayId: string, seasonCode?: string): Promise<boolean> {
  const cw = await getColorwayForPublish(colorwayId, seasonCode);
  if (!cw) return false;
  const snap = shopifySnapshot(cw, buildShopifyPreview(cw), seasonCode);
  const res = await prisma.channelPublication.updateMany({
    where: { colorwayId, channel: "SHOPIFY" },
    data: { baseline: snap, baselineAt: new Date() },
  });
  return res.count > 0;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

const LIVE_QUERY = `
  query LiveProduct($id: ID!) {
    product(id: $id) {
      id
      handle
      title
      vendor
      productType
      status
      tags
      metafields(first: 50, namespace: "${METAFIELD_NAMESPACE}") { nodes { key value } }
      variants(first: 250) { nodes { id sku price barcode } }
    }
  }
`;

interface LiveProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  metafields: { nodes: { key: string; value: string }[] };
  variants: { nodes: { id: string; sku: string | null; price: string; barcode: string | null }[] };
}

export type ChangeAction =
  | "write"
  /** Shopify already holds the master's value. */
  | "same-in-shopify"
  /** Changed in the master, but not something an update may send. */
  | "not-sent";

export interface PlannedChange {
  key: string;
  label: string;
  from: string;
  to: string;
  action: ChangeAction;
  note?: string;
}

export interface ShopifyUpdatePlan {
  colorwayId: string;
  colorwaySku: string;
  productGid: string;
  /** No baseline existed: one is recorded now and nothing is sent. */
  baselineCreated: boolean;
  changes: PlannedChange[];
  warnings: string[];
  /** Internal: what the apply step needs. */
  current: ShopifySnapshot;
  baseline: ShopifySnapshot;
  live: LiveProduct | null;
  cw: PublishColorway;
}

function liveValue(key: string, live: LiveProduct): string | null {
  const mf = new Map(live.metafields.nodes.map((m) => [m.key, m.value]));
  switch (key) {
    case "title":
      return norm(live.title);
    case "vendor":
      return norm(live.vendor);
    case "productType":
      return norm(live.productType);
    case "status":
      return live.status;
    case "price": {
      const prices = [...new Set(live.variants.nodes.map((v) => Number(v.price)))];
      return prices.length === 1 ? String(prices[0]) : null;
    }
  }
  if (key.startsWith("barcode.")) {
    const sku = key.slice(8);
    const v = live.variants.nodes.find((n) => n.sku === sku);
    return v ? norm(v.barcode) : null;
  }
  if (key.startsWith("mf.")) {
    const k = key.slice(3);
    // Product references are master ids here and gids there; not comparable.
    if (LIST_REF_METAFIELDS.includes(k) || k === "model_info") return null;
    return norm(mf.get(k));
  }
  return null;
}

/**
 * What an update would send, and why. Writes only when no baseline exists — it
 * records one, so the product is frozen as it stands rather than pushed whole.
 */
export async function planShopifyUpdate(
  colorwayId: string,
  seasonCode?: string
): Promise<ShopifyUpdatePlan> {
  const cw = await getColorwayForPublish(colorwayId, seasonCode);
  if (!cw) throw new Error("Colorway not found");
  const pub = cw.publications.find((p) => p.channel === "SHOPIFY");
  if (!pub?.externalId) throw new Error("Not on Shopify — this is a create, not an update.");
  const preview = buildShopifyPreview(cw);
  const current = shopifySnapshot(cw, preview, seasonCode);
  const warnings: string[] = [];

  const stored = pub.baseline as ShopifySnapshot | null;
  if (!stored) {
    await prisma.channelPublication.update({
      where: { id: pub.id },
      data: { baseline: current, baselineAt: new Date() },
    });
    warnings.push(
      "This product had no push baseline, so one was recorded from Origo as it is now and nothing was sent. " +
        "Save the fields you want to push again, then push."
    );
    return {
      colorwayId,
      colorwaySku: cw.colorwaySku,
      productGid: pub.externalId,
      baselineCreated: true,
      changes: [],
      warnings,
      current,
      baseline: current,
      live: null,
      cw,
    };
  }

  const keys = Object.keys(current).filter((k) => !k.startsWith("_"));
  const moved = keys.filter((k) => k in stored && norm(stored[k]) !== norm(current[k]));

  // A price read under another season is a different number, not an edit.
  const priceSeasonMoved = norm(stored._priceSeason) !== norm(current._priceSeason);

  const live = moved.length
    ? (await shopifyGraphQL<{ product: LiveProduct | null }>(LIVE_QUERY, { id: pub.externalId })).product
    : null;
  if (moved.length && !live) throw new Error("The Shopify product no longer exists.");

  const changes: PlannedChange[] = [];
  for (const key of moved) {
    const change: PlannedChange = {
      key,
      label: labelFor(key),
      from: stored[key],
      to: current[key],
      action: "write",
    };
    if (key === "price" && priceSeasonMoved) {
      change.action = "not-sent";
      change.note = `price was last recorded for season ${stored._priceSeason || "(none)"}, now read for ${current._priceSeason || "(none)"} — not compared`;
    } else if (key === "sizes") {
      change.action = "not-sent";
      change.note = "sizes are added with Add size and never deleted by a push";
    } else if (key.startsWith("media.")) {
      change.action = "not-sent";
      change.note = "image changes are not pushed to a live product — update them in Shopify";
    } else if (key.startsWith("barcode.") && !live!.variants.nodes.some((n) => n.sku === key.slice(8))) {
      change.action = "not-sent";
      change.note = "this size is not on the Shopify product";
    } else if (key === "status" && live!.status === "ACTIVE" && current.status !== "ACTIVE") {
      change.action = "not-sent";
      change.note = "a live product is never unpublished by a push — change status in Shopify";
    } else {
      const lv = liveValue(key, live!);
      const same =
        lv !== null &&
        (key === "price" ? Number(lv) === Number(current[key]) : lv === norm(current[key]));
      if (same) change.action = "same-in-shopify";
    }
    changes.push(change);
  }

  return {
    colorwayId,
    colorwaySku: cw.colorwaySku,
    productGid: pub.externalId,
    baselineCreated: false,
    changes,
    warnings,
    current,
    baseline: stored,
    live,
    cw,
  };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ShopifyUpdateResult {
  plan: Omit<ShopifyUpdatePlan, "current" | "baseline" | "live" | "cw">;
  written: string[];
  failed: { keys: string[]; error: string }[];
  warnings: string[];
}

/**
 * Send a plan. Each group (product fields, metafields, variants) is its own
 * mutation; the baseline advances for every key that was written or already
 * matched Shopify, group by group, so a failure leaves only its own keys
 * pending for the next push.
 */
export async function applyShopifyUpdate(
  plan: ShopifyUpdatePlan,
  helpers: {
    resolveModelText: (gid: string) => Promise<string | null>;
    resolveProductGids: (ids: string[]) => Promise<{ gids: string[]; skipped: number }>;
  }
): Promise<ShopifyUpdateResult> {
  const warnings = [...plan.warnings];
  const written: string[] = [];
  const failed: { keys: string[]; error: string }[] = [];
  const settled = new Set<string>(
    plan.changes.filter((c) => c.action === "same-in-shopify").map((c) => c.key)
  );
  const toWrite = plan.changes.filter((c) => c.action === "write");
  const live = plan.live;
  const { current } = plan;

  for (const c of plan.changes)
    if (c.action === "not-sent") warnings.push(`${c.label} not sent: ${c.note}.`);

  // --- product fields ---
  const productKeys = toWrite.filter((c) => ["title", "vendor", "productType", "status", "tags"].includes(c.key));
  if (productKeys.length && live) {
    const input: Record<string, unknown> = { id: plan.productGid };
    for (const c of productKeys) {
      if (c.key === "tags") {
        // Additive, as before: a tag added in Shopify admin is never removed.
        const mine = current.tags ? current.tags.split(", ") : [];
        input.tags = [...new Set([...live.tags, ...mine])];
      } else input[c.key] = current[c.key];
    }
    try {
      const r = await shopifyGraphQL<{ productUpdate: { userErrors: { message: string }[] } }>(
        PRODUCT_UPDATE_MUTATION,
        { input }
      );
      if (r.productUpdate.userErrors.length)
        throw new Error(r.productUpdate.userErrors.map((e) => e.message).join(", "));
      for (const c of productKeys) written.push(c.key);
    } catch (err) {
      failed.push({ keys: productKeys.map((c) => c.key), error: msg(err) });
    }
  }

  // --- metafields ---
  const mfKeys = toWrite.filter((c) => c.key.startsWith("mf."));
  if (mfKeys.length) {
    const set: { ownerId: string; namespace: string; key: string; type: string; value: string }[] = [];
    const del: { ownerId: string; namespace: string; key: string }[] = [];
    const resolved: string[] = [];
    for (const c of mfKeys) {
      const key = c.key.slice(3);
      const value = current[c.key];
      if (!value) {
        // Emptied in the master since the baseline: that is a decision to clear.
        del.push({ ownerId: plan.productGid, namespace: METAFIELD_NAMESPACE, key });
        resolved.push(c.key);
        continue;
      }
      if (key in TEXT_METAFIELDS) {
        if (key === "color_hex" && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
          warnings.push(`Swatch not sent — "${value}" is not a 6-digit hex colour.`);
          continue;
        }
        set.push({ ownerId: plan.productGid, namespace: METAFIELD_NAMESPACE, key, type: TEXT_METAFIELDS[key], value });
      } else if (key === "model_info") {
        const text = await helpers.resolveModelText(value);
        if (!text) {
          warnings.push("Model not sent — the model could not be read.");
          continue;
        }
        set.push({ ownerId: plan.productGid, namespace: METAFIELD_NAMESPACE, key, type: "multi_line_text_field", value: text });
      } else if (LIST_REF_METAFIELDS.includes(key)) {
        const ids = JSON.parse(value) as string[];
        const { gids, skipped } = await helpers.resolveProductGids(ids);
        if (skipped) warnings.push(`${c.label}: ${skipped} linked product(s) not yet on Shopify — skipped.`);
        if (!gids.length) continue;
        set.push({ ownerId: plan.productGid, namespace: METAFIELD_NAMESPACE, key, type: "list.product_reference", value: JSON.stringify(gids) });
      }
      resolved.push(c.key);
    }
    try {
      if (set.length) {
        const r = await shopifyGraphQL<{ metafieldsSet: { userErrors: { message: string }[] } }>(
          METAFIELDS_SET_MUTATION,
          { metafields: set }
        );
        if (r.metafieldsSet.userErrors.length)
          throw new Error(r.metafieldsSet.userErrors.map((e) => e.message).join(", "));
      }
      if (del.length) {
        const r = await shopifyGraphQL<{ metafieldsDelete: { userErrors: { message: string }[] } }>(
          METAFIELDS_DELETE_MUTATION,
          { metafields: del }
        );
        if (r.metafieldsDelete.userErrors.length)
          throw new Error(r.metafieldsDelete.userErrors.map((e) => e.message).join(", "));
      }
      written.push(...resolved);
    } catch (err) {
      failed.push({ keys: resolved, error: msg(err) });
    }
  }

  // --- variants: price on every size the master holds, barcodes per size ---
  const variantKeys = toWrite.filter((c) => c.key === "price" || c.key.startsWith("barcode."));
  if (variantKeys.length && live) {
    const masterSkus = new Set(plan.cw.variants.map((v) => v.variantSku));
    const bySku = new Map(live.variants.nodes.filter((n) => n.sku).map((n) => [n.sku!, n]));
    const rows = new Map<string, Record<string, unknown>>();
    const row = (id: string) => rows.get(id) ?? rows.set(id, { id }).get(id)!;
    for (const c of variantKeys) {
      if (c.key === "price") {
        // Only the sizes the master holds. A size Shopify sells that the master
        // does not keep its own price — the master has no claim on it.
        for (const [sku, n] of bySku) if (masterSkus.has(sku)) row(n.id).price = current.price;
        const other = live.variants.nodes.filter((n) => !n.sku || !masterSkus.has(n.sku)).length;
        if (other) warnings.push(`Price left alone on ${other} Shopify size(s) the master does not hold.`);
      } else {
        const n = bySku.get(c.key.slice(8));
        if (n) row(n.id).barcode = current[c.key];
      }
    }
    try {
      if (rows.size) {
        const r = await shopifyGraphQL<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
          PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
          { productId: plan.productGid, variants: [...rows.values()] }
        );
        if (r.productVariantsBulkUpdate.userErrors.length)
          throw new Error(r.productVariantsBulkUpdate.userErrors.map((e) => e.message).join(", "));
      }
      written.push(...variantKeys.map((c) => c.key));
    } catch (err) {
      failed.push({ keys: variantKeys.map((c) => c.key), error: msg(err) });
    }
  }

  // --- advance the baseline for what is now true on both sides ---
  const advance = [...written, ...settled];
  const next: ShopifySnapshot = { ...plan.baseline };
  for (const k of advance) next[k] = current[k];
  // Keys the baseline never had (a new size's barcode, a new field) start from
  // the master's value: they were never a difference anyone made.
  for (const k of Object.keys(current)) if (!(k in next)) next[k] = current[k];
  if (written.includes("price") || settled.has("price")) next._priceSeason = current._priceSeason;
  await prisma.channelPublication.updateMany({
    where: { colorwayId: plan.colorwayId, channel: "SHOPIFY" },
    data: {
      baseline: next,
      baselineAt: new Date(),
      ...(failed.length
        ? { lastPushStatus: "partial" }
        : { lastPushedAt: new Date(), lastPushStatus: "ok" }),
    },
  });

  const { current: _c, baseline: _b, live: _l, cw: _cw, ...rest } = plan;
  void _c; void _b; void _l; void _cw;
  return { plan: rest, written, failed, warnings };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
