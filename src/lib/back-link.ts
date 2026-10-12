// "Back" goes where you came from.
//
// The product and media pages were written for catalogue v1, where you arrived
// from a style, so their back link always went to the style. From the Livid or
// External grid that lost the place — and, before filters were remembered, the
// filtering too. A link into a product now carries ?from=<the page it left>.

/** Only an Origo catalogue path is accepted, so `from` cannot send anyone off-site. */
export function safeFrom(from: string | string[] | undefined | null): string | null {
  const v = Array.isArray(from) ? from[0] : from;
  if (!v || !v.startsWith("/catalog") || v.startsWith("//")) return null;
  return v;
}

const LABELS: Array<[RegExp, string]> = [
  [/^\/catalog\/edit/, "Livid products"],
  [/^\/catalog\/external/, "External products"],
  [/^\/catalog\/media/, "Media"],
  [/^\/catalog\/vintage/, "Vintage"],
  [/^\/catalog\/styles/, "Style"],
  [/^\/catalog\/publishing/, "Publishing"],
  [/^\/catalog\/lookup/, "Look up"],
];

export function backLabel(path: string): string {
  return LABELS.find(([re]) => re.test(path))?.[1] ?? "Back";
}

/** Append ?from= to a link, keeping any query it already has. */
export function withFrom(href: string, from: string | null): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}
