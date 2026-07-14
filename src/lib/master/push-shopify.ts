// Live Shopify push (Phase 3). Creates or updates a Shopify product from a
// master colorway. First pass: core product fields + free-text custom.*
// metafields (incl. style_name). Variants, media, and reference/product GIDs
// come in later passes (see the preview warnings).
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import {
  PRODUCT_CREATE_MUTATION,
  PRODUCT_UPDATE_MUTATION,
} from "@/lib/shopify/mutations";
import { METAFIELD_NAMESPACE } from "@/lib/constants";
import { getColorwayForPublish, buildShopifyPreview } from "./publish";

interface ProductMutationResult {
  productCreate?: {
    product: { id: string; handle: string; status: string } | null;
    userErrors: { field: string[]; message: string }[];
  };
  productUpdate?: {
    product: { id: string } | null;
    userErrors: { field: string[]; message: string }[];
  };
}

export interface PushResult {
  action: "create" | "update";
  productGid: string;
  handle: string | null;
  metafieldsSet: number;
  adminUrl: string;
}

export async function pushColorwayToShopify(id: string): Promise<PushResult> {
  const cw = await getColorwayForPublish(id);
  if (!cw) throw new Error("Colorway not found");
  const preview = buildShopifyPreview(cw);

  const existing = cw.publications.find((p) => p.channel === "SHOPIFY");
  const action: "create" | "update" = existing?.externalId ? "update" : "create";

  // Core product fields (free-text metafields only in this pass — the reference
  // and file metafields need GID resolution / Shopify file uploads first).
  const freeTextKeys = new Set([
    "short_description",
    "full_description",
    "details",
    "style_tagline",
    "style_name",
    "color_hex",
  ]);
  const metafields = preview.metafields
    .filter((m) => freeTextKeys.has(m.key))
    .map((m) => ({ namespace: m.namespace, key: m.key, value: m.value, type: m.type }));

  const productInput: Record<string, unknown> = {
    title: preview.product.title,
    vendor: preview.product.vendor ?? undefined,
    productType: preview.product.productType ?? undefined,
    tags: preview.product.tags,
    status: preview.product.status, // ACTIVE | DRAFT | ARCHIVED
    metafields,
  };

  let productGid: string;
  let handle: string | null = null;

  if (action === "create") {
    productInput.handle = preview.product.handle;
    const res = await shopifyGraphQL<ProductMutationResult>(PRODUCT_CREATE_MUTATION, {
      input: productInput,
    });
    const errs = res.productCreate?.userErrors ?? [];
    if (errs.length) throw new Error(`productCreate: ${errs.map((e) => e.message).join(", ")}`);
    const product = res.productCreate?.product;
    if (!product) throw new Error("productCreate returned no product");
    productGid = product.id;
    handle = product.handle;
  } else {
    productInput.id = existing!.externalId;
    const res = await shopifyGraphQL<ProductMutationResult>(PRODUCT_UPDATE_MUTATION, {
      input: productInput,
    });
    const errs = res.productUpdate?.userErrors ?? [];
    if (errs.length) throw new Error(`productUpdate: ${errs.map((e) => e.message).join(", ")}`);
    productGid = existing!.externalId!;
    // productUpdate with metafields in input sets them; belt-and-braces below is
    // skipped for update since input handles it.
  }

  // Record the publication.
  await prisma.channelPublication.upsert({
    where: { colorwayId_channel: { colorwayId: id, channel: "SHOPIFY" } },
    create: {
      colorwayId: id,
      channel: "SHOPIFY",
      published: true,
      externalId: productGid,
      lastPushedAt: new Date(),
      lastPushStatus: "ok",
    },
    update: {
      published: true,
      externalId: productGid,
      lastPushedAt: new Date(),
      lastPushStatus: "ok",
    },
  });

  const numericId = productGid.split("/").pop();
  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "");
  const adminUrl = `https://${store}/admin/products/${numericId}`;

  return { action, productGid, handle, metafieldsSet: metafields.length, adminUrl };
}
