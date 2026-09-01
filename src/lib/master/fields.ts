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

// All fields that support a per-channel override. Tags is a list (edited as a
// comma-separated string); the rest are text. Base tags live on Colorway.tags;
// channel tag overrides live in ChannelContent as a comma-joined string.
export interface OverrideField {
  key: string;
  label: string;
  kind: "list" | "text";
  multiline?: boolean;
}

export const OVERRIDE_FIELDS: OverrideField[] = [
  { key: "tags", label: "Tags", kind: "list" },
  ...SPLIT_TEXT_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    kind: "text" as const,
    multiline: f.multiline,
  })),
];

export const OVERRIDE_FIELD_KEYS = OVERRIDE_FIELDS.map((f) => f.key);

export const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];
