// Cin7 Core External API v2 — the subset of fields we consume.

export interface Cin7Product {
  ID: string;
  SKU: string;
  Name: string;
  Brand: string | null;
  Category: string | null;
  Type: string | null; // "Stock" | "Service" | ...
  Barcode: string | null;
  Weight: number | null;
  WeightUnits: string | null; // "g" | "kg" | ...
  HSCode: string | null;
  CountryOfOrigin: string | null;
  AverageCost: number | null;
  ShortDescription: string | null;
  Description: string | null;
  Status: string | null; // "Active" | ...
  // Named price tiers, e.g. { Retail, NOK, EUR, USD, "MSRP EUR", "MSRP USD", ... }
  PriceTiers: Record<string, number> | null;
}

export interface Cin7AvailabilityRow {
  ID: string;
  SKU: string;
  Name: string;
  Barcode: string | null;
  Location: string;
  OnHand: number;
  Allocated: number;
  Available: number;
  OnOrder: number;
}
