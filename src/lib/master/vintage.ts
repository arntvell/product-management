// Online vintage: the facts that are true of every one-of-one garment.
//
// Vintage is discriminated by BRAND, not by `Source`. The 2,086 online-vintage
// colorways in the master arrived as `CIN7_IMPORT` because Cin7 was the product
// master before Threadflow and Loom existed, and `Source` becomes pure history
// once Cin7 retires. What a product IS belongs on the brand, which is also what
// `isLoomEligible` and `readinessProfileFor` key off.

/** The brand every online- and store-vintage product carries. */
export const VINTAGE_BRAND_NAME = "Vintage";

/**
 * Where a vintage garment's single unit lives on Shopify.
 *
 * Read off `inventoryItem.inventoryLevels` of existing `VN-ONLN-*` variants on
 * 2026-09-25: of the store's five locations, this one holds the stock for all
 * 12 sampled, and the other four hold zero. It is a constant rather than a
 * lookup because the token lacks the `read_locations` scope — `locations { name }`
 * is denied — so the only way to discover it is to find a stocked vintage
 * variant, and a location lookup that depends on stock existing is not a
 * lookup. Override per environment if the store is ever reorganised.
 */
export const VINTAGE_STOCK_LOCATION_GID =
  process.env.SHOPIFY_VINTAGE_LOCATION_GID || "gid://shopify/Location/72485175545";

/**
 * Customs, identical on every garment. Straight from the sheet's DEAR export:
 * `AdditionalAttribute1=GB`, `2=63090000`, `3=Used Vintage garment`,
 * `Weight=500` gram, `CountryOfOrigin=United Kingdom`.
 */
export const VINTAGE_CUSTOMS = {
  hsCode: "63090000",
  customsDescription: "Used Vintage garment",
  weightKg: 0.5,
  countryOfOrigin: "United Kingdom",
} as const;

/** True for the vintage brand, however it is cased. */
export function isVintageBrand(brandName: string | null | undefined): boolean {
  return brandName?.trim().toLowerCase() === VINTAGE_BRAND_NAME.toLowerCase();
}

/**
 * The Shopify handle for a vintage garment: `13644` -> `13644-vintage`.
 * Matches every live product; `Colorway.colorwaySku` is `VN-ONLN-13644`, so the
 * item number is the part after the last hyphen.
 */
export function vintageHandle(colorwaySku: string): string {
  const n = colorwaySku.trim().split("-").pop() ?? colorwaySku.trim();
  return `${n}-vintage`.toLowerCase();
}

export interface VintageVariantInventory {
  /** Never oversell a garment there is exactly one of. */
  inventoryPolicy: "DENY";
  /** `InventoryLevelInput`. Present only on create — see `vintageInventory`. */
  inventoryQuantities?: Array<{ locationId: string; availableQuantity: number }>;
}

/**
 * The inventory half of a vintage variant payload.
 *
 * Quantity is sent on CREATE ONLY, and that is a deliberate policy rather than
 * an API limit — `productSet` does accept `inventoryQuantities` on an update,
 * for locations where the variant is already stocked. We decline to use it.
 * Once the garment is live its stock belongs to Loom, and a re-push to fix a
 * typo in the description must never silently restock a sold item back to 1.
 *
 * `inventoryPolicy` is sent on both. Shopify already defaults it to `DENY`, but
 * for a one-of-one this is the single most consequential field on the payload
 * and it should not rest on a default that could change.
 */
export function vintageInventory(action: "create" | "update"): VintageVariantInventory {
  return {
    inventoryPolicy: "DENY",
    ...(action === "create"
      ? {
          inventoryQuantities: [
            { locationId: VINTAGE_STOCK_LOCATION_GID, availableQuantity: 1 },
          ],
        }
      : {}),
  };
}

/**
 * `inventoryItem.cost` — what the garment cost us, for margin reporting.
 *
 * Rounded, because the sheet rounds, and defaulting to 100 when there is no
 * COST row, which is what the sheet's `2. EXPORT DEAR` does. Returned as a
 * string: Shopify's cost field is a decimal.
 */
export function vintageCost(
  prices: Array<{ currency: string; priceType: string; amount: unknown }>
): string {
  const cost = prices.find((p) => p.currency === "NOK" && p.priceType === "COST");
  const n = cost ? Number(cost.amount) : NaN;
  return String(Number.isFinite(n) && n > 0 ? Math.round(n) : 100);
}
