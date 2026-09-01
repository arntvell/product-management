// Threadflow External Read-Only API response types.
// Mirrors GET /api/external/v1/{manufacturers,products}. See the API doc and
// docs/product-master-architecture.md §5 / §10.

export interface TFAddress {
  line1: string | null;
  line2: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
}

export interface TFManufacturer {
  manufacturer_id: string;
  name: string;
  contact_email?: string | null;
  phone?: string | null;
  address: TFAddress | null;
}

/** Prices are keyed by currency code; each may carry msrp and/or wholesale. */
export type TFPrices = Record<
  string,
  { msrp?: number | null; ws?: number | null }
>;

export interface TFVariant {
  sku: string;
  barcode: string | null;
  // 1-D: { size }; 2-D (bottoms): { waist, length }
  dimensions: {
    size?: string;
    waist?: string;
    length?: string;
  };
}

export interface TFColorway {
  colorway_id: string;
  colorway_sku: string;
  name: string;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  country_of_origin: string | null;
  image: string | null; // API-key-authed image ref (relative path)
  image_original?: string | null;
  swatch: { image: string | null; hex: string | null };
  prices: TFPrices;
  dropped: boolean;
  approved_for_production: boolean;
  variants: TFVariant[];
}

export interface TFStyle {
  style_id: string;
  style_sku: string;
  style_name: string;
  gender: string | null;
  unisex: boolean;
  category: string | null;
  hs_code: string | null;
  customs_description: string | null;
  weight: string | null; // decimal string in kilograms
  season_description: string | null;
  fiber_composition: string | null;
  size_override: { low: string; high: string } | null;
  fit_pictures: string[];
  colorways: TFColorway[];
}

export interface TFProductsResponse {
  season: { id: string; code: string };
  data: TFStyle[];
  nextCursor: string | null;
}

export interface TFPaginated<T> {
  data: T[];
  nextCursor: string | null;
}
