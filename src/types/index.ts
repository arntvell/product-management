export interface Product {
  id: string; // Shopify GID
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  featuredImage: string | null;
  mediaCount: number;
  metafields: ProductMetafields;
}

export interface ProductMetafields {
  short_description: string;
  full_description: string;
  details: string;
  same_product: string; // JSON array of GIDs
  style_with: string; // JSON array of GIDs
  flat: string; // file_reference GID
  care: string; // page_reference GID
  fitguide: string; // page_reference GID
  model_info: string; // metaobject_reference GID
  recommended_collection: string; // collection_reference GID
  style_with_unisex_herre: string; // JSON array of GIDs
  style_with_unisex_dame: string; // JSON array of GIDs
  men_images: string; // JSON array of file GIDs
  women_images: string; // JSON array of file GIDs
}

export type MetafieldKey = keyof ProductMetafields;

export interface MetafieldDefinition {
  key: MetafieldKey;
  namespace: string;
  label: string;
  type:
    | "single_line_text_field"
    | "multi_line_text_field"
    | "list.product_reference"
    | "file_reference"
    | "page_reference"
    | "metaobject_reference"
    | "collection_reference"
    | "list.file_reference";
  description: string;
}

export interface ShopifyPage {
  id: string;
  title: string;
  handle: string;
  bodySummary: string;
}

export interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  image: { url: string } | null;
}

export interface MediaItem {
  id: string;
  alt: string;
  mediaContentType: string;
  preview?: { image?: { url: string } };
  image?: { url: string; width: number; height: number };
}

export interface FileNode {
  id: string;
  image?: { url: string };
  preview?: { image?: { url: string } };
  alt?: string;
}

export interface Model {
  id: string;
  handle: string;
  fields: {
    name: string;
    height: string;
    size_worn: string;
    notes: string;
  };
}

export interface DirtyCell {
  productId: string;
  field: MetafieldKey;
  value: string;
}

export interface ProductGroup {
  id: string;
  baseName: string;
  vendor: string;
  productType: string;
  members: Product[];
  linkStatus: "linked" | "partially_linked" | "not_linked";
}

export interface BulkMetafieldUpdate {
  productId: string;
  metafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>;
}

export interface ShopifyMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  featuredImage: {
    url: string;
  } | null;
  metafields: {
    edges: Array<{
      node: ShopifyMetafield;
    }>;
  };
}

export interface ProductsResponse {
  products: Product[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}
