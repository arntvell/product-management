import {
  listColorwaysForEdit,
  listSeasons,
  listColorwayOptions,
} from "@/lib/master/queries";
import { CatalogGrid } from "@/components/catalog/catalog-grid";

export const dynamic = "force-dynamic";

/**
 * External products — vintage and the resold brands.
 *
 * Separated from /catalog/edit because the two are different jobs, not two
 * filters on one job. The seasonal editor exists for Livid's own production,
 * which arrives through Threadflow, moves in drops and is priced per season.
 * An external has none of that: it is bought in, it lives until it sells out,
 * and 3,648 of the 3,674 sit on CONTINUITY — the season that means "no season".
 *
 * Showing them side by side meant everyone working here read past machinery that
 * does not apply to their half of the catalogue, and picked a season before they
 * could type a price whose answer was always the same.
 *
 * Every external is on Loom, for the stock registry rather than the wholesale
 * catalogue — Loom is how their stock stays correct. Which of Shopify and Sitoo
 * also holds one varies per product, and the Channel filter is the only thing
 * that separates, say, store vintage from online vintage.
 */
export default async function ExternalProductsPage() {
  const [rows, seasons, colorwayOptions] = await Promise.all([
    // No season filter. Every external is in exactly one season and holds a NOK
    // price in at most that one, so each row carries its own `priceSeasonId` and
    // the price column works without the page pinning anything. Pinning
    // CONTINUITY excluded the 26 that sit on FW26/SS27 — Pantherella socks,
    // Hestra gloves, two Campers — and sent whoever needed them to the seasonal
    // editor, which is the split this page exists to remove.
    listColorwaysForEdit(undefined, "external"),
    listSeasons(),
    listColorwayOptions(),
  ]);

  return (
    <CatalogGrid
      initialRows={rows}
      seasons={seasons}
      colorwayOptions={colorwayOptions}
      scope="external"
      title="External products"
      note={`${rows.length} products — vintage and the resold brands. Every one is on Loom for the stock registry; the Channel filter says which also sell online or in store.`}
    />
  );
}
