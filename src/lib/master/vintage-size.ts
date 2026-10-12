// One spelling per vintage size.
//
// The size ends up in the Shopify title — "Bomber Jacket (L)" — and in the
// size filter, so "l", "L" and " L " are three sizes to a customer. Whoever
// writes the drop should not have to remember the house style; this is it,
// read off the garments already live (L, XL, M, S, 2XL, One Size, S/M):
//
//   letters      upper case                    m -> M, xl -> XL
//   many X's     counted                       xxl -> 2XL, xxxl -> 3XL
//   one size     spelled out                   os, o/s, onesize -> One Size
//   ranges       each side on its own          s/m -> S/M, m-l -> M/L
//   anything     upper-cased letters, spaces   eu 42 -> EU 42, w32 l34 -> W32 L34
//   else         tidied, never invented
//
// Used on blur in the drop sheet (so the person sees the result) and again in
// vintage-create (so it holds whatever the client sent). Pure: no imports.

const ONE_SIZE = /^(one\s*-?\s*size|os|o\/s|onesize|one)$/i;

function letterSize(t: string): string | null {
  const m = /^(x*)(s|m|l)$/i.exec(t) ?? /^(\d)x(s|l)$/i.exec(t);
  if (!m) return null;
  const letter = m[2].toUpperCase();
  const xs = /^\d$/.test(m[1]) ? Number(m[1]) : m[1].length;
  if (letter === "M") return xs ? null : "M";
  if (xs === 0) return letter;
  if (xs === 1) return `X${letter}`;
  // XXS is how small sizes are written; large ones are counted (2XL).
  return letter === "L" ? `${xs}XL` : `${"X".repeat(xs)}S`;
}

export function normalizeVintageSize(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (ONE_SIZE.test(s)) return "One Size";
  const single = letterSize(s);
  if (single) return single;
  // A range of letter sizes: s/m, m-l, S / M.
  const parts = s.split(/\s*[/-]\s*/);
  if (parts.length === 2) {
    const a = letterSize(parts[0]);
    const b = letterSize(parts[1]);
    if (a && b) return `${a}/${b}`;
  }
  // Anything else short and plain (EU 42, W32 L34, 10Y) — letters up, nothing
  // reordered. Longer free text is the person's own words; leave it.
  if (s.length <= 12 && /^[\p{L}\d\s/.,-]+$/u.test(s)) return s.toUpperCase();
  return s;
}
