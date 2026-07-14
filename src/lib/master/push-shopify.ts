// Live Shopify push (Phase 3). Uses productSet (declarative) so create and
// update share one idempotent path: core fields, free-text custom.* metafields
// (incl. style_name/color_hex), a "Size" option, and one variant per master
// variant with the NOK MSRP price + barcode.
// Not yet: media (adopt TF -> Blob -> Shopify files) and reference/product-ref
// GID resolution (see the preview warnings).
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCT_SET_MUTATION } from "@/lib/shopify/mutations";
import { getColorwayForPublish, buildShopifyPreview } from "./publish";

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
  adminUrl: string;
}

const FREE_TEXT_KEYS = new Set([
  "short_description",
  "full_description",
  "details",
  "style_tagline",
  "style_name",
  "color_hex",
]);

export async function pushColorwayToShopify(id: string): Promise<PushResult> {
  const cw = await getColorwayForPublish(id);
  if (!cw) throw new Error("Colorway not found");
  const preview = buildShopifyPreview(cw);

  const existing = cw.publications.find((p) => p.channel === "SHOPIFY");
  const action: "create" | "update" = existing?.externalId ? "update" : "create";

  const metafields = preview.metafields
    .filter((m) => FREE_TEXT_KEYS.has(m.key))
    .map((m) => ({ namespace: m.namespace, key: m.key, value: m.value, type: m.type }));

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
    adminUrl: `https://${store}/admin/products/${numericId}`,
  };
}
