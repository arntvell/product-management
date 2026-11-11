// Stocking a product at every location.
//
// Shopify stocks a new variant at the default location only (Livid
// Sentrallager). The stores get no inventory level, and a level is what Loom's
// store stock lands in: writing Sitoo's figure to a location the variant is not
// stocked at fails with "not stocked". When Loom's retry path broke, Tom Wood
// sizes sold in Oslo showed 0 there for four weeks.
//
// So after every Shopify write Origio switches on each active location the
// product's variants are missing — at 0. It NEVER sets a quantity: the numbers
// are Loom's and Pio's. Activating a location that already has a level is not
// asked for, so a product stocked everywhere costs one read and no write.
//
// Needs `read_locations` (the list) and `write_inventory` (the activation),
// both granted 2026-11-11. Best-effort by design: the product is already live
// when this runs, so a failure is a warning for the push result, and the next
// push retries it.
import { shopifyGraphQL } from "./client";

const LOCATIONS_QUERY = `
  query ActiveLocations { locations(first: 50) { nodes { id name isActive } } }
`;

const PRODUCT_LEVELS_QUERY = `
  query ProductLevels($id: ID!) {
    product(id: $id) {
      status
      variants(first: 250) {
        nodes {
          sku
          inventoryItem {
            id
            tracked
            inventoryLevels(first: 50) { nodes { location { id } } }
          }
        }
      }
    }
  }
`;

const ACTIVATE_MUTATION = `
  mutation Activate($inventoryItemId: ID!, $updates: [InventoryBulkToggleActivationInput!]!) {
    inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $updates) {
      userErrors { field message code }
    }
  }
`;

export interface StockedResult {
  /** Locations switched on, as "SKU @ location". */
  activated: string[];
  /** One line each for what could not be switched on. */
  warnings: string[];
}

let cached: { at: number; locations: { id: string; name: string }[] } | null = null;

/** The store's active locations. Cached for a few minutes: a bulk push asks once. */
export async function activeLocations(): Promise<{ id: string; name: string }[]> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.locations;
  const res = await shopifyGraphQL<{ locations: { nodes: { id: string; name: string; isActive: boolean }[] } }>(
    LOCATIONS_QUERY
  );
  const locations = res.locations.nodes.filter((l) => l.isActive).map(({ id, name }) => ({ id, name }));
  cached = { at: Date.now(), locations };
  return locations;
}

/**
 * Switch on every active location a product's tracked variants are missing.
 * Archived products are left alone. Never throws.
 */
export async function ensureStockedEverywhere(
  productGid: string,
  opts: { dryRun?: boolean } = {}
): Promise<StockedResult> {
  const activated: string[] = [];
  const warnings: string[] = [];
  try {
    const locations = await activeLocations();
    const name = new Map(locations.map((l) => [l.id, l.name]));
    const res = await shopifyGraphQL<{
      product: {
        status: string;
        variants: {
          nodes: {
            sku: string | null;
            inventoryItem: {
              id: string;
              tracked: boolean;
              inventoryLevels: { nodes: { location: { id: string } }[] };
            } | null;
          }[];
        };
      } | null;
    }>(PRODUCT_LEVELS_QUERY, { id: productGid });
    const product = res.product;
    if (!product || product.status === "ARCHIVED") return { activated, warnings };

    for (const v of product.variants.nodes) {
      const item = v.inventoryItem;
      if (!item?.tracked) continue;
      const has = new Set(item.inventoryLevels.nodes.map((l) => l.location.id));
      const missing = locations.filter((l) => !has.has(l.id));
      if (!missing.length) continue;
      const label = v.sku ?? item.id;
      if (opts.dryRun) {
        for (const l of missing) activated.push(`${label} @ ${l.name}`);
        continue;
      }
      try {
        const r = await shopifyGraphQL<{
          inventoryBulkToggleActivation: { userErrors: { message: string }[] };
        }>(ACTIVATE_MUTATION, {
          inventoryItemId: item.id,
          updates: missing.map((l) => ({ locationId: l.id, activate: true })),
        });
        const errs = r.inventoryBulkToggleActivation.userErrors;
        if (errs.length)
          warnings.push(
            `${label}: not stocked at ${missing.map((l) => name.get(l.id)).join(", ")} — ${errs.map((e) => e.message).join(", ")}`
          );
        else for (const l of missing) activated.push(`${label} @ ${l.name}`);
      } catch (err) {
        warnings.push(
          `${label}: not stocked at ${missing.map((l) => l.name).join(", ")} — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    warnings.push(
      `Could not check the store locations: ${err instanceof Error ? err.message : String(err)}. The next push retries.`
    );
  }
  return { activated, warnings };
}
