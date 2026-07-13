// Which enrichment fields are editable in the master, and which can be
// overridden per channel (B2C Shopify vs B2B Loom). See
// docs/product-master-architecture.md §4.3.

export const CHANNELS = ["SHOPIFY", "LOOM"] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  SHOPIFY: "Shopify (B2C)",
  LOOM: "Loom (B2B)",
};

/** Free-text enrichment fields that resolve as: channel override -> base. */
export const SPLIT_TEXT_FIELDS = [
  { key: "shortDescription", label: "Short description", multiline: true },
  { key: "fullDescription", label: "Full description", multiline: true },
  { key: "details", label: "Details", multiline: true },
  { key: "styleTagline", label: "Style tagline", multiline: false },
  { key: "styleName", label: "Style name", multiline: false },
] as const;

export type SplitFieldKey = (typeof SPLIT_TEXT_FIELDS)[number]["key"];

export const SPLIT_FIELD_KEYS = SPLIT_TEXT_FIELDS.map((f) => f.key);

export const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];
