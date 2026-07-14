// Live Shopify push (Phase 3). Uses productSet (declarative) so create and
// update share one idempotent path: core fields, free-text custom.* metafields
// (incl. style_name/color_hex), a "Size" option, and one variant per master
// variant with the NOK MSRP price + barcode.
// Not yet: media (adopt TF -> Blob -> Shopify files) and reference/product-ref
// GID resolution (see the preview warnings).
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_SET_MUTATION } from "@/lib/shopify/mutations";
import { METAFIELD_NAMESPACE } from "@/lib/constants";
import { getColorwayForPublish, buildShopifyPreview } from "./publish";

type PublishColorway = NonNullable<Awaited<ReturnType<typeof getColorwayForPublish>>>;
type Metafield = { namespace: string; key: string; value: string; type: string };

/** Resolve master colorway ids -> the Shopify product GIDs of those already pushed. */
async function resolveProductGids(masterIds: string[]): Promise<{ gids: string[]; skipped: number }> {
  if (masterIds.length === 0) return { gids: [], skipped: 0 };
  const pubs = await prisma.channelPublication.findMany({
    where: { colorwayId: { in: masterIds }, channel: "SHOPIFY", NOT: { externalId: null } },
    select: { colorwayId: true, externalId: true },
  });
  const byId = new Map(pubs.map((p) => [p.colorwayId, p.externalId!]));
  const gids = masterIds.map((id) => byId.get(id)).filter(Boolean) as string[];
  return { gids, skipped: masterIds.length - gids.length };
}

/** model_info is a text metafield: resolve the metaobject id -> "Model is X tall …". */
async function resolveModelText(metaobjectGid: string): Promise<string | null> {
  try {
    const res = await shopifyGraphQL<{
      metaobject: { fields: { key: string; value: string }[] } | null;
    }>(
      `query M($id: ID!) { metaobject(id: $id) { fields { key value } } }`,
      { id: metaobjectGid }
    );
    const fields = res.metaobject?.fields ?? [];
    const get = (k: string) => fields.find((f) => f.key === k)?.value ?? "";
    const height = get("height");
    const size = get("size_worn");
    if (!height && !size) return null;
    return `Model is ${height} tall and wearing a size ${size}`.replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
}

/** Build the full custom.* metafield set (free-text, refs, links, model). */
async function buildMetafields(
  cw: PublishColorway,
  warnings: string[]
): Promise<Metafield[]> {
  const ns = METAFIELD_NAMESPACE;
  const mf: Metafield[] = [];
  const add = (key: string, type: string, value: string | null | undefined) => {
    if (value && String(value).trim()) mf.push({ namespace: ns, key, value: String(value), type });
  };
  // Shopify-resolved free text (override -> base).
  const rs = (field: string, base: string | null) => {
    const o = cw.channelContent.find((c) => c.channel === "SHOPIFY" && c.field === field);
    return o ? o.value : base;
  };
  add("short_description", "multi_line_text_field", rs("shortDescription", cw.shortDescription));
  add("full_description", "multi_line_text_field", rs("fullDescription", cw.fullDescription));
  add("details", "multi_line_text_field", rs("details", cw.details));
  add("style_tagline", "multi_line_text_field", rs("styleTagline", cw.styleTagline));
  add("style_name", "single_line_text_field", rs("styleName", cw.styleName));
  add("color_hex", "color", cw.swatchHex);

  // Reference metafields (Shopify GIDs, stored directly).
  add("care_page", "page_reference", cw.carePageId);
  add("fitguide", "page_reference", cw.fitguidePageId);
  add("recommended_product_from_collection", "collection_reference", cw.recommendedCollectionId);

  // model_info is text on Shopify — resolve the picked model to a sentence.
  if (cw.modelInfoId) add("model_info", "multi_line_text_field", await resolveModelText(cw.modelInfoId));

  // Product links: master ids -> Shopify product GIDs (skip not-yet-pushed).
  const links: [string, string[]][] = [
    ["same_product", cw.sameProduct],
    ["style_with", cw.styleWith],
    ["style_with_unisex_herre", cw.styleWithUnisexHerre],
    ["style_with_unisex_dame", cw.styleWithUnisexDame],
  ];
  for (const [key, ids] of links) {
    if (ids.length === 0) continue;
    const { gids, skipped } = await resolveProductGids(ids);
    if (gids.length) add(key, "list.product_reference", JSON.stringify(gids));
    if (skipped > 0)
      warnings.push(`${key}: ${skipped} linked product(s) not yet on Shopify — skipped.`);
  }
  return mf;
}

interface ProductSetResult {
  productSet: {
    product: {
      id: string;
      handle: string;
      status: string;
      variants: { edges: { node: { id: string; sku: string; price: string } }[] };
    } | null;
    userErrors: { field: string[]; message: string }[];
  };
}

export interface PushResult {
  action: "create" | "update";
  productGid: string;
  handle: string | null;
  variants: number;
  metafields: number;
  warnings: string[];
  adminUrl: string;
}

export async function pushColorwayToShopify(id: string): Promise<PushResult> {
  const cw = await getColorwayForPublish(id);
  if (!cw) throw new Error("Colorway not found");
  const preview = buildShopifyPreview(cw);

  const existing = cw.publications.find((p) => p.channel === "SHOPIFY");
  const action: "create" | "update" = existing?.externalId ? "update" : "create";

  const warnings: string[] = [];
  const metafields = await buildMetafields(cw, warnings);

  // One "Size" option; one variant per master variant (deduped size labels).
  const sizes = [...new Set(preview.variants.map((v) => v.size))];
  const hasVariants = sizes.length > 0;
  const variants = preview.variants.map((v) => ({
    optionValues: [{ optionName: "Size", name: v.size }],
    ...(v.price ? { price: v.price } : {}),
    inventoryItem: { sku: v.sku },
    ...(v.barcode ? { barcode: v.barcode } : {}),
  }));

  const input: Record<string, unknown> = {
    ...(existing?.externalId ? { id: existing.externalId } : {}),
    title: preview.product.title,
    handle: preview.product.handle,
    vendor: preview.product.vendor ?? undefined,
    productType: preview.product.productType ?? undefined,
    tags: preview.product.tags,
    status: preview.product.status,
    metafields,
    ...(hasVariants
      ? {
          productOptions: [
            { name: "Size", position: 1, values: sizes.map((name) => ({ name })) },
          ],
          variants,
        }
      : {}),
  };

  const res = await shopifyGraphQL<ProductSetResult>(PRODUCT_SET_MUTATION, { input });
  const errs = res.productSet?.userErrors ?? [];
  if (errs.length) throw new Error(`productSet: ${errs.map((e) => e.message).join(", ")}`);
  const product = res.productSet?.product;
  if (!product) throw new Error("productSet returned no product");

  await prisma.channelPublication.upsert({
    where: { colorwayId_channel: { colorwayId: id, channel: "SHOPIFY" } },
    create: {
      colorwayId: id,
      channel: "SHOPIFY",
      published: true,
      externalId: product.id,
      lastPushedAt: new Date(),
      lastPushStatus: "ok",
    },
    update: {
      published: true,
      externalId: product.id,
      lastPushedAt: new Date(),
      lastPushStatus: "ok",
    },
  });

  const numericId = product.id.split("/").pop();
  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "");
  return {
    action,
    productGid: product.id,
    handle: product.handle,
    variants: product.variants.edges.length,
    metafields: metafields.length,
    warnings,
    adminUrl: `https://${store}/admin/products/${numericId}`,
  };
}
