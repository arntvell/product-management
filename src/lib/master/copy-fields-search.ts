// Search for a product whose merchandising fields can be copied onto a
// selection.
//
// The source has to be searchable in SHOPIFY, not only in the master. The copy
// for the older products lives on the live store: Brass exists here as seven
// Cin7-imported colorways with tags and not one character of description, while
// Shopify has the full text. A master-only picker would find nothing for exactly
// the products this exists to serve. So both are searched, and each candidate
// says where it came from.
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { PRODUCTS_QUERY } from "@/lib/shopify/queries";
import type { CopySource, CopyableField } from "./copy-fields";

/**
 * Shopify custom.* metafield key -> master field. Mirrors METAFIELD_MAP in
 * import-shopify.ts, extended with the reference keys — master stores the same
 * Shopify GIDs, so those copy across verbatim.
 *
 * model_info is deliberately absent: on Shopify it is a rendered sentence
 * ("Model is 186cm tall and wearing a size M"), not the metaobject id the master
 * holds, so there is nothing to copy back into.
 */
const SHOPIFY_METAFIELD_TO_FIELD: Record<string, CopyableField> = {
  short_description: "shortDescription",
  full_description: "fullDescription",
  details: "details",
  style_tagline: "styleTagline",
  style_name: "styleName",
  color_hex: "swatchHex",
  care_page: "carePageId",
  fitguide: "fitguidePageId",
  recommended_product_from_collection: "recommendedCollectionId",
};

interface ShopifyProductsResult {
  products: {
    edges: {
      node: {
        id: string;
        title: string;
        handle: string;
        vendor: string;
        productType: string;
        tags: string[];
        featuredImage: { url: string } | null;
        metafields: { edges: { node: { key: string; value: string } }[] };
      };
    }[];
  };
}

async function searchShopify(q: string, limit: number): Promise<CopySource[]> {
  // Shopify search syntax: match the title or the handle.
  const data = await shopifyGraphQL<ShopifyProductsResult>(PRODUCTS_QUERY, {
    first: limit,
    query: `title:*${q}* OR handle:*${q}*`,
  });
  return data.products.edges.map(({ node }) => {
    const values: Partial<Record<CopyableField, string>> = {};
    for (const { node: mf } of node.metafields.edges) {
      const target = SHOPIFY_METAFIELD_TO_FIELD[mf.key];
      if (target && mf.value?.trim()) values[target] = mf.value;
    }
    if (node.productType?.trim()) values.productType = node.productType;
    if (node.tags?.length) values.tags = node.tags.join(", ");
    return {
      origin: "shopify" as const,
      id: node.id,
      title: node.title,
      reference: node.handle,
      vendor: node.vendor || null,
      productType: node.productType || null,
      imageUrl: node.featuredImage?.url ?? null,
      values,
    };
  });
}

async function searchMaster(q: string, limit: number): Promise<CopySource[]> {
  const rows = await prisma.colorway.findMany({
    where: {
      archived: false,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { colorwaySku: { contains: q, mode: "insensitive" } },
        { style: { styleName: { contains: q, mode: "insensitive" } } },
      ],
    },
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      colorwaySku: true,
      vendor: true,
      productType: true,
      tags: true,
      swatchHex: true,
      shortDescription: true,
      fullDescription: true,
      details: true,
      styleTagline: true,
      styleName: true,
      carePageId: true,
      fitguidePageId: true,
      recommendedCollectionId: true,
      style: { select: { styleName: true } },
      seasonImages: { where: { slot: "MAIN" }, take: 1, select: { url: true } },
    },
  });

  return rows.map((r) => {
    const values: Partial<Record<CopyableField, string>> = {};
    const put = (f: CopyableField, v: string | null) => {
      if (v && v.trim()) values[f] = v;
    };
    put("fullDescription", r.fullDescription);
    put("shortDescription", r.shortDescription);
    put("details", r.details);
    put("styleTagline", r.styleTagline);
    put("styleName", r.styleName);
    put("productType", r.productType);
    put("swatchHex", r.swatchHex);
    put("carePageId", r.carePageId);
    put("fitguidePageId", r.fitguidePageId);
    put("recommendedCollectionId", r.recommendedCollectionId);
    if (r.tags.length) values.tags = r.tags.join(", ");
    return {
      origin: "master" as const,
      id: r.id,
      title: `${r.style.styleName} · ${r.name}`,
      reference: r.colorwaySku,
      vendor: r.vendor,
      productType: r.productType,
      imageUrl: r.seasonImages[0]?.url ?? null,
      values,
    };
  });
}

/**
 * Candidate sources for a search term, Shopify first.
 *
 * A product with nothing worth copying is dropped — offering an empty source is
 * how you copy a blank over something. Shopify being unreachable degrades to
 * master-only results with a note rather than failing the search outright.
 */
export async function findCopySources(
  q: string,
  limit = 10
): Promise<{ sources: CopySource[]; warnings: string[] }> {
  const term = q.trim();
  if (term.length < 2) return { sources: [], warnings: [] };

  const warnings: string[] = [];
  const [shopify, master] = await Promise.all([
    searchShopify(term, limit).catch((err) => {
      warnings.push(
        `Could not search Shopify (${
          err instanceof Error ? err.message : "unknown error"
        }) — showing master products only.`
      );
      return [] as CopySource[];
    }),
    searchMaster(term, limit),
  ]);

  const hasSomething = (s: CopySource) => Object.keys(s.values).length > 0;
  return {
    sources: [...shopify.filter(hasSomething), ...master.filter(hasSomething)],
    warnings,
  };
}
