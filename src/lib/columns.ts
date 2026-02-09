import type { MetafieldKey } from "@/types";
import { UNISEX_VENDOR } from "./constants";

export type RenderType =
  | "text"
  | "ref_product"
  | "ref_page"
  | "ref_collection"
  | "ref_metaobject"
  | "ref_file";

export interface ColumnDef {
  key: MetafieldKey;
  label: string;
  renderType: RenderType;
  minWidth: number;
  /** Shown by default when no user preference is saved */
  defaultVisible: boolean;
  /** If set, column only applies to products matching this predicate */
  visibilityPredicate?: (product: { vendor: string }) => boolean;
}

export const COLUMN_DEFINITIONS: ColumnDef[] = [
  {
    key: "short_description",
    label: "Short Description",
    renderType: "text",
    minWidth: 180,
    defaultVisible: true,
  },
  {
    key: "full_description",
    label: "Full Description",
    renderType: "text",
    minWidth: 180,
    defaultVisible: true,
  },
  {
    key: "details",
    label: "Details",
    renderType: "text",
    minWidth: 180,
    defaultVisible: true,
  },
  {
    key: "flat",
    label: "Flat",
    renderType: "ref_file",
    minWidth: 100,
    defaultVisible: false,
  },
  {
    key: "care",
    label: "Care",
    renderType: "ref_page",
    minWidth: 140,
    defaultVisible: false,
  },
  {
    key: "fitguide",
    label: "Fit Guide",
    renderType: "ref_page",
    minWidth: 140,
    defaultVisible: false,
  },
  {
    key: "model_info",
    label: "Model Info",
    renderType: "ref_metaobject",
    minWidth: 140,
    defaultVisible: false,
  },
  {
    key: "recommended_collection",
    label: "Rec. Collection",
    renderType: "ref_collection",
    minWidth: 140,
    defaultVisible: false,
  },
  {
    key: "same_product",
    label: "Same Product",
    renderType: "ref_product",
    minWidth: 140,
    defaultVisible: true,
  },
  {
    key: "style_with",
    label: "Style With",
    renderType: "ref_product",
    minWidth: 140,
    defaultVisible: true,
  },
  {
    key: "style_with_unisex_herre",
    label: "Style With (Herre)",
    renderType: "ref_product",
    minWidth: 140,
    defaultVisible: false,
    visibilityPredicate: (p) => p.vendor === UNISEX_VENDOR,
  },
  {
    key: "style_with_unisex_dame",
    label: "Style With (Dame)",
    renderType: "ref_product",
    minWidth: 140,
    defaultVisible: false,
    visibilityPredicate: (p) => p.vendor === UNISEX_VENDOR,
  },
];

export const DEFAULT_VISIBLE_KEYS = new Set(
  COLUMN_DEFINITIONS.filter((c) => c.defaultVisible).map((c) => c.key)
);

export const TEXT_COLUMNS = COLUMN_DEFINITIONS.filter(
  (c) => c.renderType === "text"
);
export const REF_COLUMNS = COLUMN_DEFINITIONS.filter(
  (c) => c.renderType !== "text"
);
