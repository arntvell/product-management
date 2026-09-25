// The highest online-vintage item number Shopify has published.
//
// Needed because the master is not the authority on this. Drops 185 and 186 ran
// from the spreadsheet and were never imported, so Origio stops at 13682 while
// the store has garments up to 13762. Numbering a new drop from the master's
// high-water mark would reuse numbers that are already live and already on
// printed labels.
import { shopifyGraphQL } from "./client";

const NEWEST_VINTAGE_QUERY = `
  query NewestVintage($first: Int!) {
    products(first: $first, query: "vendor:Vintage", sortKey: CREATED_AT, reverse: true) {
      nodes { handle }
    }
  }
`;

/**
 * Scans the most recently created vintage products for the highest `<n>-vintage`
 * handle.
 *
 * Sorted by creation rather than by handle because handles sort as text — "9999"
 * beats "13762" alphabetically — and Shopify cannot sort by a numeric slice of
 * one. Recency is a good proxy: item numbers only ever go up, so the newest
 * products carry the highest numbers. 250 is several drops' worth of margin.
 *
 * Returns 0 rather than throwing when Shopify cannot be reached: the caller
 * falls back to the master's high-water mark, which is safe if it is current
 * and reported as a warning when it is not.
 */
export async function highestVintageItemNumber(first = 250): Promise<number> {
  try {
    const res = await shopifyGraphQL<{ products: { nodes: { handle: string }[] } }>(
      NEWEST_VINTAGE_QUERY,
      { first }
    );
    let max = 0;
    for (const n of res.products?.nodes ?? []) {
      const m = /^(\d+)-vintage$/.exec(n.handle.trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  } catch {
    return 0;
  }
}
