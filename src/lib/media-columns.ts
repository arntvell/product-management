import { UNISEX_VENDOR } from "./constants";

export type MediaColumnKey = "product_media" | "men_images" | "women_images";

export interface MediaColumnDef {
  key: MediaColumnKey;
  label: string;
  minWidth: number;
  defaultVisible: boolean;
  visibilityPredicate?: (product: { vendor: string }) => boolean;
}

export const MEDIA_COLUMN_DEFINITIONS: MediaColumnDef[] = [
  {
    key: "product_media",
    label: "Product Media",
    minWidth: 160,
    defaultVisible: true,
  },
  {
    key: "men_images",
    label: "Men Images",
    minWidth: 160,
    defaultVisible: true,
    visibilityPredicate: (p) => p.vendor === UNISEX_VENDOR,
  },
  {
    key: "women_images",
    label: "Women Images",
    minWidth: 160,
    defaultVisible: true,
    visibilityPredicate: (p) => p.vendor === UNISEX_VENDOR,
  },
];

export const DEFAULT_MEDIA_VISIBLE_KEYS = new Set<MediaColumnKey>(
  MEDIA_COLUMN_DEFINITIONS.filter((c) => c.defaultVisible).map((c) => c.key)
);
