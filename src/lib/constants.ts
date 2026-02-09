import type { MetafieldDefinition } from "@/types";

export const METAFIELD_NAMESPACE = "custom";

export const UNISEX_VENDOR = "Livid Unisex";

export const METAFIELD_DEFINITIONS: MetafieldDefinition[] = [
  {
    key: "short_description",
    namespace: METAFIELD_NAMESPACE,
    label: "Short Description",
    type: "multi_line_text_field",
    description: "Brief product description for listings",
  },
  {
    key: "full_description",
    namespace: METAFIELD_NAMESPACE,
    label: "Full Description",
    type: "multi_line_text_field",
    description: "Detailed product description",
  },
  {
    key: "details",
    namespace: METAFIELD_NAMESPACE,
    label: "Details",
    type: "multi_line_text_field",
    description: "Product details and specifications",
  },
  {
    key: "same_product",
    namespace: METAFIELD_NAMESPACE,
    label: "Same Product",
    type: "list.product_reference",
    description: "References to the same product in different colors",
  },
  {
    key: "style_with",
    namespace: METAFIELD_NAMESPACE,
    label: "Style With",
    type: "list.product_reference",
    description: "Products to style/pair with this one",
  },
  {
    key: "flat",
    namespace: METAFIELD_NAMESPACE,
    label: "Flat",
    type: "file_reference",
    description: "Flat lay image file reference",
  },
  {
    key: "care",
    namespace: METAFIELD_NAMESPACE,
    label: "Care",
    type: "page_reference",
    description: "Care instructions page reference",
  },
  {
    key: "fitguide",
    namespace: METAFIELD_NAMESPACE,
    label: "Fit Guide",
    type: "page_reference",
    description: "Fit guide page reference",
  },
  {
    key: "model_info",
    namespace: METAFIELD_NAMESPACE,
    label: "Model Info",
    type: "single_line_text_field",
    description: "Model information text (auto-generated from model picker)",
  },
  {
    key: "recommended_collection",
    namespace: METAFIELD_NAMESPACE,
    label: "Recommended Collection",
    type: "collection_reference",
    description: "Recommended collection reference",
  },
  {
    key: "style_with_unisex_herre",
    namespace: METAFIELD_NAMESPACE,
    label: "Style With (Herre)",
    type: "list.product_reference",
    description: "Unisex style-with for men",
  },
  {
    key: "style_with_unisex_dame",
    namespace: METAFIELD_NAMESPACE,
    label: "Style With (Dame)",
    type: "list.product_reference",
    description: "Unisex style-with for women",
  },
  {
    key: "men_images",
    namespace: METAFIELD_NAMESPACE,
    label: "Men Images",
    type: "list.file_reference",
    description: "Men images for unisex products",
  },
  {
    key: "women_images",
    namespace: METAFIELD_NAMESPACE,
    label: "Women Images",
    type: "list.file_reference",
    description: "Women images for unisex products",
  },
];

export const METAFIELD_KEYS = METAFIELD_DEFINITIONS.map((d) => d.key);

export const PRODUCTS_PER_PAGE = 50;
