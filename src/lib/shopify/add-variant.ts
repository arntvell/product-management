// Adding one size to a product Shopify already sells.
//
// NOT pushColorwayToShopify. That is a declarative productSet over the whole
// colourway: it rewrites the title, handle, tags, metafields and media of a live
// product from the master, and runs the merchandising gate. For "add a 42" that
// is a great deal of collateral — about 119 master names differ from their live
// titles, and every one of them would be retitled by the push. So this is the
// narrow write: one productVariantsBulkCreate on the product that is already
// there, with everything the new size cannot know copied from a sibling that is
// already selling.
//
// What is copied, and why:
//   price / compareAtPrice  an omitted price is 0 on a live product; a sale
//                           price (compareAt) belongs to the whole product
//   inventoryPolicy         CONTINUE on a sibling means the shop oversells on
//                           purpose; the new size should behave the same
//   tracked                 an untracked variant on an ACTIVE product is
//                           purchasable immediately, with no stock at all. Sent
//                           only when true: false is the API's default, and the
//                           less of inventoryItem we write, the less can be
//                           refused
//   customs                 country of origin and HS code are per garment, not
//                           per size
//
// What is NOT done: stocking it at the siblings' locations. That is
// inventoryQuantities, which needs write_inventory, and Origio's token has only
// write_products — asking would fail the whole create. Shopify stocks a new
// variant at its default location; the plan says when the siblings are stocked
// in more places than that.

import { shopifyGraphQL } from "./client";
import { fetchShopifyVariants } from "./link";
import { recordShopifyVariantRefs, type VariantRefResult } from "./adopt";
import { normalizeSku } from "@/lib/master/sku";
import { sortSizes } from "@/lib/master/size-order";

const PRODUCT_QUERY = `
  query AddSizeProduct($id: ID!) {
    product(id: $id) {
      id
      title
      status
      options { id name position optionValues { id name } }
      variants(first: 250) {
        nodes {
          id
          sku
          barcode
          price
          compareAtPrice
          inventoryPolicy
          taxable
          selectedOptions { name value }
          inventoryItem {
            id
            tracked
            requiresShipping
            countryCodeOfOrigin
            harmonizedSystemCode
            inventoryLevels(first: 25) { nodes { location { id } } }
          }
        }
      }
    }
  }
`;

const VARIANT_PRODUCT_QUERY = `
  query VariantProduct($id: ID!) { productVariant(id: $id) { id product { id } } }
`;

const BULK_CREATE_MUTATION = `
  mutation AddSize($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id sku barcode inventoryItem { id } }
      userErrors { field message code }
    }
  }
`;

const OPTIONS_REORDER_MUTATION = `
  mutation ReorderSizes($productId: ID!, $options: [OptionReorderInput!]!) {
    productOptionsReorder(productId: $productId, options: $options) {
      userErrors { field message code }
    }
  }
`;

interface LiveVariant {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryPolicy: string;
  taxable: boolean;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: {
    id: string;
    tracked: boolean;
    requiresShipping: boolean;
    countryCodeOfOrigin: string | null;
    harmonizedSystemCode: string | null;
    inventoryLevels: { nodes: { location: { id: string } }[] };
  } | null;
}

interface LiveProduct {
  id: string;
  title: string;
  status: string;
  options: { id: string; name: string; position: number; optionValues: { id: string; name: string }[] }[];
  variants: { nodes: LiveVariant[] };
}

export interface ShopifyAddSizeInput {
  colorwayId: string;
  /** The master's record of where this colourway lives in Shopify. */
  publicationGid: string | null;
  /** ProductVariant gids of sizes already linked, the fallback route to the product. */
  siblingVariantGids: string[];
  /** Master SKUs of the existing sizes, to pick the sibling to copy from. */
  siblingSkus: string[];
  /** The master's NOK MSRP, used only when the live siblings disagree on price. */
  masterPriceNok: string | null;
  size: { variantId: string; sku: string; barcode: string | null; sizeLabel: string };
}

export interface ShopifyAddSizePlan {
  state: "write" | "not-live" | "refused" | "exists";
  note?: string;
  productGid?: string;
  productTitle?: string;
  productStatus?: string;
  optionName?: string;
  price?: string;
  compareAtPrice?: string | null;
  priceSource?: "siblings" | "master";
  /** Locations the siblings are stocked in — reported, not written. */
  locations?: string[];
  tracked?: boolean;
  copiedFrom?: string | null;
  /** The whole planned mutation input, for the report. */
  input?: Record<string, unknown>;
  /** Whether the option values would be put back into size order. */
  reorder?: string[] | null;
  /** When the SKU is already on the product: the node, so it can be linked. */
  existingNode?: { id: string; sku: string | null; barcode: string | null; inventoryItem: { id: string } | null };
}

export interface ShopifyAddSizeResult extends ShopifyAddSizePlan {
  written: boolean;
  variantGid?: string;
  inventoryItemGid?: string | null;
  refs?: VariantRefResult;
  warnings: string[];
}

/** Resolve the product without writing anything — adoptExistingShopifyProduct repairs as it goes. */
async function resolveProductGid(input: ShopifyAddSizeInput): Promise<string | null> {
  if (input.publicationGid) return input.publicationGid;
  for (const gid of input.siblingVariantGids.slice(0, 3)) {
    const res = await shopifyGraphQL<{ productVariant: { product: { id: string } } | null }>(
      VARIANT_PRODUCT_QUERY,
      { id: gid }
    );
    if (res.productVariant?.product.id) return res.productVariant.product.id;
  }
  return null;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function same<T>(values: T[]): T | undefined {
  return values.length && values.every((v) => v === values[0]) ? values[0] : undefined;
}

export async function planShopifyAddSize(input: ShopifyAddSizeInput): Promise<ShopifyAddSizePlan> {
  const productGid = await resolveProductGid(input);
  if (!productGid) return { state: "not-live", note: "not linked to Shopify — the size goes out with the product's first publish" };

  const { product } = await shopifyGraphQL<{ product: LiveProduct | null }>(PRODUCT_QUERY, { id: productGid });
  if (!product)
    return { state: "refused", note: `the master points at ${productGid}, which Shopify no longer has` };
  if (product.status === "ARCHIVED")
    return { state: "refused", productGid, note: "the Shopify product is archived" };

  const live = product.variants.nodes;
  const target = normalizeSku(input.size.sku);

  // Already there — a retry after a crash, or somebody added it by hand.
  const already = live.find((v) => v.sku && normalizeSku(v.sku) === target);
  if (already)
    return {
      state: "exists",
      productGid,
      productTitle: product.title,
      note:
        `already on this product as ${already.id}` +
        (already.barcode ? `, with barcode ${already.barcode} in Shopify` : ", with no barcode in Shopify") +
        " — it will be linked, not created again",
      existingNode: {
        id: already.id,
        sku: already.sku,
        barcode: already.barcode,
        inventoryItem: already.inventoryItem ? { id: already.inventoryItem.id } : null,
      },
    };

  // One option only. A two-option product (Colour × Size) cannot take a size
  // without also choosing its colour, and "Default Title" is a product that was
  // never sized: adding a size to it is a restructure, not an addition.
  if (product.options.length !== 1)
    return {
      state: "refused",
      productGid,
      note: `the Shopify product has ${product.options.length} options (${product.options.map((o) => o.name).join(", ")}) — only a single size option can take a new size`,
    };
  const option = product.options[0];
  if (option.optionValues.length === 1 && /^default title$/i.test(option.optionValues[0].name))
    return { state: "refused", productGid, note: "the Shopify product has no size option (Default Title)" };
  if (option.optionValues.some((v) => v.name.toUpperCase() === input.size.sizeLabel.toUpperCase()))
    return {
      state: "refused",
      productGid,
      note: `Shopify already has a "${input.size.sizeLabel}" on this product under another SKU`,
    };

  // The SKU or barcode must not be live anywhere else in the shop.
  const clashes: string[] = [];
  const bySku = await fetchShopifyVariants(`sku:${quote(input.size.sku)}`);
  for (const r of bySku)
    if (r.sku && normalizeSku(r.sku) === target && !r.archived) clashes.push(`SKU on ${r.productGid}`);
  if (input.size.barcode) {
    const byCode = await fetchShopifyVariants(`barcode:${quote(input.size.barcode)}`);
    for (const r of byCode)
      if (r.barcode === input.size.barcode && !r.archived) clashes.push(`barcode on ${r.sku ?? r.variantGid}`);
  }
  if (clashes.length) return { state: "refused", productGid, note: `already in Shopify: ${clashes.join("; ")}` };

  // Copy from a sibling the master knows, falling back to any live variant.
  const siblingSet = new Set(input.siblingSkus.map(normalizeSku));
  const siblings = live.filter((v) => v.sku && siblingSet.has(normalizeSku(v.sku)));
  const pool = siblings.length ? siblings : live;
  const model = pool[0];
  if (!model) return { state: "refused", productGid, note: "the Shopify product has no variants to copy from" };

  const agreedPrice = same(pool.map((v) => v.price));
  const agreedCompare = same(pool.map((v) => v.compareAtPrice ?? null));
  const price = agreedPrice ?? input.masterPriceNok ?? null;
  if (!price) return { state: "refused", productGid, note: "the sizes disagree on price and the master has no NOK MSRP" };

  // Ids only: the token has no read_locations scope, so a location's name is
  // not readable — asking for it fails the whole query. Counted for the report,
  // not written (see the note at the top).
  const locations = [
    ...new Set(pool.flatMap((v) => v.inventoryItem?.inventoryLevels.nodes ?? []).map((l) => l.location.id)),
  ];

  const inv = model.inventoryItem;
  const mutationInput: Record<string, unknown> = {
    optionValues: [{ optionName: option.name, name: input.size.sizeLabel }],
    price,
    ...(agreedPrice !== undefined && agreedCompare ? { compareAtPrice: agreedCompare } : {}),
    ...(input.size.barcode ? { barcode: input.size.barcode } : {}),
    inventoryPolicy: model.inventoryPolicy,
    taxable: model.taxable,
    inventoryItem: {
      sku: input.size.sku,
      ...(inv?.tracked ? { tracked: true } : {}),
      requiresShipping: inv?.requiresShipping ?? true,
      ...(inv?.countryCodeOfOrigin ? { countryCodeOfOrigin: inv.countryCodeOfOrigin } : {}),
      ...(inv?.harmonizedSystemCode ? { harmonizedSystemCode: inv.harmonizedSystemCode } : {}),
    },
  };

  // Shopify appends a new value at the end of the picker, so a 40 added to
  // 39 41 42 would read 39 41 42 40. Put it in its place — but only when every
  // value sorts naturally, so a picker we cannot read is never shuffled on a guess.
  const values = [...option.optionValues.map((v) => v.name), input.size.sizeLabel];
  const sorted = sortSizes(values);
  const reorder = sorted && sorted.join("|") !== values.join("|") ? sorted : null;

  return {
    state: "write",
    productGid,
    productTitle: product.title,
    productStatus: product.status,
    optionName: option.name,
    price,
    compareAtPrice: agreedPrice !== undefined ? agreedCompare ?? null : null,
    priceSource: agreedPrice !== undefined ? "siblings" : "master",
    locations,
    tracked: Boolean(inv?.tracked),
    copiedFrom: model.sku,
    input: mutationInput,
    reorder,
    ...(agreedPrice === undefined
      ? { note: "the live sizes disagree on price, so the master's NOK MSRP is used" }
      : {}),
  };
}

export async function applyShopifyAddSize(input: ShopifyAddSizeInput): Promise<ShopifyAddSizeResult> {
  const plan = await planShopifyAddSize(input);
  const warnings: string[] = [];
  if (plan.state === "exists" && plan.existingNode) {
    const refs = await recordShopifyVariantRefs(input.colorwayId, [plan.existingNode]);
    return { ...plan, written: false, refs, variantGid: plan.existingNode.id, warnings };
  }
  if (plan.state !== "write") return { ...plan, written: false, warnings };

  const res = await shopifyGraphQL<{
    productVariantsBulkCreate: {
      productVariants: { id: string; sku: string | null; barcode: string | null; inventoryItem: { id: string } | null }[] | null;
      userErrors: { field: string[] | null; message: string; code: string | null }[];
    };
  }>(BULK_CREATE_MUTATION, { productId: plan.productGid, variants: [plan.input] });

  const errs = res.productVariantsBulkCreate.userErrors;
  if (errs.length) throw new Error(`productVariantsBulkCreate: ${errs.map((e) => e.message).join(", ")}`);
  const node = res.productVariantsBulkCreate.productVariants?.find(
    (v) => v.sku && normalizeSku(v.sku) === normalizeSku(input.size.sku)
  );
  if (!node) throw new Error("Shopify accepted the size but did not return it — run the Shopify linker before retrying");

  // Identity straight away: Loom's registry joins on the InventoryItem gid, and
  // the Loom send that follows this is what carries it.
  const refs = await recordShopifyVariantRefs(input.colorwayId, [node]);

  if (plan.reorder) {
    try {
      const r = await shopifyGraphQL<{ productOptionsReorder: { userErrors: { message: string }[] } }>(
        OPTIONS_REORDER_MUTATION,
        {
          productId: plan.productGid,
          options: [{ name: plan.optionName, values: plan.reorder.map((name) => ({ name })) }],
        }
      );
      const e = r.productOptionsReorder.userErrors;
      if (e.length) warnings.push(`size added, but the picker order was not changed: ${e.map((x) => x.message).join(", ")}`);
    } catch (err) {
      warnings.push(`size added, but the picker order was not changed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ...plan,
    written: true,
    variantGid: node.id,
    inventoryItemGid: node.inventoryItem?.id ?? null,
    refs,
    warnings,
  };
}
