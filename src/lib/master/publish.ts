// Master -> Shopify mapping + dry-run preview (Phase 3).
// Pure computation: given a colorway, produce the payload that WOULD be pushed
// to Shopify, resolving Shopify-channel content (override -> base). This does
// NOT write to Shopify — the live push is wired separately and run deliberately.
import { prisma } from "@/lib/db";
import { METAFIELD_NAMESPACE } from "@/lib/constants";

export async function getColorwayForPublish(id: string) {
  return prisma.colorway.findUnique({
    where: { id },
    include: {
      style: true,
      brand: true,
      channelContent: true,
      variants: { orderBy: { sizeLabel: "asc" } },
      prices: true,
      media: { orderBy: { position: "asc" } },
      seasonImages: true,
      publications: true,
    },
  });
}

type PublishColorway = NonNullable<
  Awaited<ReturnType<typeof getColorwayForPublish>>
>;

export interface ShopifyMetafieldPreview {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

export interface ShopifyPreview {
  action: "create" | "update";
  externalId: string | null;
  unisex: boolean;
  product: {
    title: string;
    handle: string;
    vendor: string | null;
    productType: string | null;
    status: string;
    tags: string[];
  };
  metafields: ShopifyMetafieldPreview[];
  variants: Array<{ sku: string; barcode: string | null; size: string; price: string | null }>;
  media: string[];
  // Role-tagged media that become file-reference metafields on push
  // (uploaded to Shopify Files, then custom.flat / men_images / women_images).
  roleMedia: { flat: string[]; men: string[]; women: string[] };
  warnings: string[];
}

/** Resolve a splittable field's Shopify value: channel override -> base. */
function resolveShopify(
  cw: PublishColorway,
  field: string,
  base: string | null
): string | null {
  const override = cw.channelContent.find(
    (c) => c.channel === "SHOPIFY" && c.field === field
  );
  return override ? override.value : base;
}

// Reference metafields hold Shopify GIDs / id lists (kept as-is, per the
// decision to stay Shopify-GID-based for now). Flat / unisex photos are NOT
// here — they come from media roles (see roleMedia below).
const LIST_REFERENCE_FIELDS: Array<{ key: string; get: (c: PublishColorway) => string[] }> = [
  { key: "same_product", get: (c) => c.sameProduct },
  { key: "style_with", get: (c) => c.styleWith },
  { key: "style_with_unisex_herre", get: (c) => c.styleWithUnisexHerre },
  { key: "style_with_unisex_dame", get: (c) => c.styleWithUnisexDame },
];

const SINGLE_REFERENCE_FIELDS: Array<{ key: string; type: string; get: (c: PublishColorway) => string | null }> = [
  { key: "care_page", type: "page_reference", get: (c) => c.carePageId },
  { key: "fitguide", type: "page_reference", get: (c) => c.fitguidePageId },
  { key: "recommended_product_from_collection", type: "collection_reference", get: (c) => c.recommendedCollectionId },
  { key: "model_info", type: "metaobject_reference", get: (c) => c.modelInfoId },
];

export function buildShopifyPreview(cw: PublishColorway): ShopifyPreview {
  const warnings: string[] = [];
  const mf: ShopifyMetafieldPreview[] = [];
  const add = (key: string, type: string, value: string | null) => {
    if (value && value.trim())
      mf.push({ namespace: METAFIELD_NAMESPACE, key, type, value });
  };

  // Free-text enrichment (Shopify-resolved).
  add("short_description", "multi_line_text_field", resolveShopify(cw, "shortDescription", cw.shortDescription));
  add("full_description", "multi_line_text_field", resolveShopify(cw, "fullDescription", cw.fullDescription));
  add("details", "multi_line_text_field", resolveShopify(cw, "details", cw.details));
  add("style_tagline", "multi_line_text_field", resolveShopify(cw, "styleTagline", cw.styleTagline));
  add("style_name", "single_line_text_field", resolveShopify(cw, "styleName", cw.styleName));
  add("color_hex", "color", cw.swatchHex);

  // Reference metafields (GID lists / single GIDs), kept as-is.
  for (const f of LIST_REFERENCE_FIELDS) {
    const ids = f.get(cw);
    if (ids.length) add(f.key, "list.product_reference", JSON.stringify(ids));
  }
  for (const f of SINGLE_REFERENCE_FIELDS) add(f.key, f.type, f.get(cw));

  // Tags: Shopify-resolved (override comma string -> base array).
  const tagOverride = cw.channelContent.find((c) => c.channel === "SHOPIFY" && c.field === "tags");
  const tags = tagOverride
    ? tagOverride.value.split(",").map((t) => t.trim()).filter(Boolean)
    : cw.tags;

  // Price: colorway-level NOK MSRP applied to every variant (Shopify has no
  // per-size pricing here).
  const nokMsrp = cw.prices.find((p) => p.currency === "NOK" && p.priceType === "MSRP");
  const price = nokMsrp ? nokMsrp.amount.toString() : null;
  if (!price) warnings.push("No NOK MSRP price set — variants would have no price.");
  if (cw.variants.length === 0) warnings.push("No variants — Shopify needs at least one.");

  const nonPublicMedia = [...cw.media, ...cw.seasonImages].filter(
    (m) => !/^https?:\/\//i.test(m.url)
  ).length;
  if (nonPublicMedia > 0)
    warnings.push(
      `${nonPublicMedia} image(s) are Threadflow refs — adopt them into Blob before pushing (Shopify can't fetch the proxy).`
    );

  // Media routing depends on whether the style is unisex.
  const unisex = cw.style.unisex;
  const galleryUrls = cw.media.filter((m) => m.role === "GALLERY").map((m) => m.url);
  const roleMedia = {
    flat: cw.media.filter((m) => m.role === "FLAT").map((m) => m.url),
    men: cw.media.filter((m) => m.role === "MEN").map((m) => m.url),
    women: cw.media.filter((m) => m.role === "WOMEN").map((m) => m.url),
  };
  const seasonUrls = cw.seasonImages.map((s) => s.url);
  const dedupe = (arr: string[]) => arr.filter((u, i) => arr.indexOf(u) === i);

  let media: string[];
  if (unisex) {
    // Unisex: gallery lives in men_images/women_images metafields; the flat is
    // the sole Shopify media-section image.
    media = dedupe(roleMedia.flat);
    if (roleMedia.men.length)
      add("men_images", "list.file_reference", `${roleMedia.men.length} image(s) via role → Shopify files`);
    if (roleMedia.women.length)
      add("women_images", "list.file_reference", `${roleMedia.women.length} image(s) via role → Shopify files`);
    if (roleMedia.flat.length === 0)
      warnings.push("Unisex product: no Flat-role image — Shopify media section would be empty.");
    if (roleMedia.men.length === 0 && roleMedia.women.length === 0)
      warnings.push("Unisex product: no Men/Women-role images for the gallery metafields.");
  } else {
    // Men/Women: gallery images go to the Shopify media section.
    media = dedupe([...galleryUrls, ...seasonUrls]);
    if (media.length === 0)
      warnings.push("No Gallery-role media — Shopify media section would be empty.");
  }

  // Flat metafield is set regardless of gender.
  if (roleMedia.flat.length)
    add("flat", "file_reference", `${roleMedia.flat.length} image via role → Shopify file`);

  const shopifyPub = cw.publications.find((p) => p.channel === "SHOPIFY");

  return {
    action: shopifyPub?.externalId ? "update" : "create",
    externalId: shopifyPub?.externalId ?? null,
    unisex,
    product: {
      title: cw.name,
      handle: cw.colorwaySku.toLowerCase(),
      vendor: cw.vendor,
      productType: cw.productType,
      status: cw.status,
      tags,
    },
    metafields: mf,
    variants: cw.variants.map((v) => ({
      sku: v.variantSku,
      barcode: v.barcode,
      size: v.sizeLabel,
      price,
    })),
    media,
    roleMedia,
    warnings,
  };
}
