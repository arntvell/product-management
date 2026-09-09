// Copy merchandising fields off an existing product onto a selection — the
// shapes and helpers shared by the picker UI and the server-side search.
//
// Deliberately free of prisma and the Shopify client: the dialog is a client
// component, and importing the search from it dragged the database driver into
// the browser bundle. The search lives in copy-fields-search.ts.
//
// A new style is often a variation on a garment that has already been written
// once — the APT shirt reads much like Brass. Rather than retyping it, find the
// product that already has the copy, take the fields worth taking, and edit from
// there.

/** Fields that can be copied, in the order they are offered. */
export const COPYABLE_FIELDS = [
  { field: "fullDescription", label: "Full description", long: true },
  { field: "shortDescription", label: "Short description", long: true },
  { field: "details", label: "Details", long: true },
  { field: "styleTagline", label: "Tagline", long: false },
  { field: "styleName", label: "Style name", long: false },
  { field: "productType", label: "Product type", long: false },
  { field: "tags", label: "Tags", long: false },
  { field: "swatchHex", label: "Swatch", long: false },
  { field: "carePageId", label: "Care page", long: false },
  { field: "fitguidePageId", label: "Fit guide", long: false },
  { field: "recommendedCollectionId", label: "Collection", long: false },
] as const;

export type CopyableField = (typeof COPYABLE_FIELDS)[number]["field"];

export interface CopySource {
  /** Where the values came from, so the picker can say. */
  origin: "shopify" | "master";
  /** Shopify product GID, or the master colorway id. */
  id: string;
  title: string;
  /** Handle on Shopify; colorwaySku in the master. */
  reference: string;
  vendor: string | null;
  productType: string | null;
  imageUrl: string | null;
  /** Only the fields this source actually has a value for. */
  values: Partial<Record<CopyableField, string>>;
}

/** Drop tags for a readable preview; the value copied is still the original. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
