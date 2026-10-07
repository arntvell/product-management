import { UNISEX_VENDOR } from "./constants";
import { parseGidList, serializeGidList } from "./utils";

export type MediaColumnKey = "product_media" | FileRefKey;

/** Metafields holding Shopify file references, editable from the media panel. */
export type FileRefKey = "men_images" | "women_images" | "flat";

export const FILE_REF_LABELS: Record<FileRefKey, string> = {
  men_images: "Men Images",
  women_images: "Women Images",
  flat: "Flat",
};

/** Flat is a single file_reference (a bare GID); the others are JSON GID lists. */
export function readFileRefGids(key: FileRefKey, value: string): string[] {
  if (key === "flat") return value ? [value] : [];
  return parseGidList(value);
}

/** Inverse of readFileRefGids. For flat, the newest file wins. */
export function writeFileRefGids(key: FileRefKey, gids: string[]): string {
  if (key === "flat") return gids[gids.length - 1] ?? "";
  return serializeGidList(gids);
}

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
  {
    key: "flat",
    label: "Flat",
    minWidth: 120,
    defaultVisible: true,
  },
];

export const DEFAULT_MEDIA_VISIBLE_KEYS = new Set<MediaColumnKey>(
  MEDIA_COLUMN_DEFINITIONS.filter((c) => c.defaultVisible).map((c) => c.key)
);
