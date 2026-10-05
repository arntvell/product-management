// Showing descriptions that contain HTML, without changing them.
//
// 2,643 of the 2,869 populated `fullDescription` values carry markup, almost all
// of it from the Cin7 import, which copied Shopify's `custom.full_description`
// metafield verbatim — and that metafield holds a storefront description block,
// wrapper div and all:
//
//   <div class="product--info product--description">
//   <h3 class="hide">Description</h3>
//   <meta charset="utf-8">
//   <p>Made in Portugal</p>
//
// MOST OF IT IS NOT NOISE. Across those rows the markup is 29,701 <p>, 15,882
// <strong>, 11,996 <br>, 3,010 <a> and a few hundred list and table tags — the
// actual formatting of the copy. Stripping it would not produce clean text, it
// would produce one run-on paragraph on 2,643 live product pages, because
// `publish.ts` pushes this field back to Shopify.
//
// So the data is left exactly as it is and only the DISPLAY is cleaned. What a
// person reads in a grid cell is the text; what gets stored, and pushed, is
// whatever was there.

/** Tags that carry no text and only ever appeared as migration debris. */
const DROPPED_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
/**
 * `<h3 class="hide">Description</h3>` — the storefront's visually-hidden
 * section heading, carried along by the migration. It renders nothing on the
 * shop and should render nothing here; stripping tags alone would leave the
 * word "Description" at the top of 5,890 descriptions.
 */
const HIDDEN_HEADING = /<(h[1-6])\b[^>]*\bclass="[^"]*\bhide\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi;
/** Tags whose boundaries are a line break when rendered as plain text. */
const BREAKS = /<\/?(p|div|br|li|tr|h[1-6])\b[^>]*>/gi;

/**
 * A readable one-line-per-paragraph rendering of a value that may be HTML.
 *
 * Deliberately not a parser. These values come from one migration with one
 * shape, the output is only ever shown to a person, and a dependency to render a
 * grid cell is a poor trade.
 */
export function toPlainText(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.includes("<")) return value;
  return value
    // CRLF first: the import carried Windows line endings inside the markup, and
    // a stray \r between tags shows up as an empty line in the rendering.
    .replace(/\r\n?/g, "\n")
    .replace(DROPPED_BLOCKS, "")
    .replace(HIDDEN_HEADING, "")
    .replace(BREAKS, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // The wrapper block leaves a run of blank lines where it was.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Whether a value carries markup, so the UI can say the text is a rendering. */
export function hasMarkup(value: string | null | undefined): boolean {
  return !!value && /<\/?[a-z][^>]*>/i.test(value);
}
