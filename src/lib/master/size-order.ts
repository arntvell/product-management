// The order sizes are worn in, read off the labels themselves.
//
// Not SizeSystemEntry.position: a system built from a range and then extended
// holds "UK Shoes" as 3 4 … 13 3.5 4.5 … 12.5 — the half sizes were appended.
// Sorting a live Shopify size picker by that would scramble it. The labels are
// what the storefront and the till show, so their natural order is the one
// that can be trusted.
//
// Returns null when the labels are not all of one recognisable kind. A caller
// that reorders a live channel must then leave the order alone rather than
// guess.

const LADDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL", "OS", "ONE SIZE"];
const LADDER_ALIAS: Record<string, string> = { XXL: "2XL", XXXL: "3XL" };

function ladderIndex(label: string): number {
  const u = label.trim().toUpperCase();
  return LADDER.indexOf(LADDER_ALIAS[u] ?? u);
}

function twoD(label: string): [number, number] | null {
  const m = label.trim().toUpperCase().match(/^W?(\d+(?:\.\d+)?)\s*[/X]\s*L?(\d+(?:\.\d+)?)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function sortSizes(labels: string[]): string[] | null {
  if (!labels.length) return [];
  if (labels.every((l) => /^\d+(?:[.,]\d+)?$/.test(l.trim())))
    return [...labels].sort((a, b) => Number(a.replace(",", ".")) - Number(b.replace(",", ".")));
  if (labels.every((l) => ladderIndex(l) >= 0)) return [...labels].sort((a, b) => ladderIndex(a) - ladderIndex(b));
  if (labels.every((l) => twoD(l))) {
    return [...labels].sort((a, b) => {
      const [wa, la] = twoD(a)!;
      const [wb, lb] = twoD(b)!;
      return wa - wb || la - lb;
    });
  }
  return null;
}

/** For display, where any order beats none: natural when possible, else as given. */
export function displaySizes<T>(items: T[], label: (t: T) => string): T[] {
  const order = sortSizes(items.map(label));
  if (!order) return items;
  const pos = new Map(order.map((l, i) => [l, i]));
  return [...items].sort((a, b) => pos.get(label(a))! - pos.get(label(b))!);
}
