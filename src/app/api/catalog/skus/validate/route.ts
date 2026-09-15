import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildSku, normalizeSku, parseSku, validateSku, type SkuInput } from "@/lib/master/sku";
import { loadSkuCorpus } from "@/lib/master/sku-corpus";

export const dynamic = "force-dynamic";

// POST /api/catalog/skus/validate
//   { sku } | { suggest: { prefix, style, color?, size?, modifiers? } }
//
// Backs the product builder: checks a typed SKU against the master before the
// product is created, or proposes one from the garment's attributes. Generating
// is the stronger of the two — two people entering the same garment then produce
// the same string, and the unique index rejects the second.
export async function POST(req: Request) {
  let body: { sku?: string; suggest?: SkuInput };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Candidates only. This used to load every colorway SKU on every call — behind
  // a field that validates as you type. loadSkuCorpus narrows to the SKUs that
  // could actually collide, which scripts/check-sku-corpus.ts proves loses no
  // match compareSku would have made (4,607 -> 197 on average).
  const probe = body.sku ?? (body.suggest ? buildSku(body.suggest) : "");
  const corpus = await loadSkuCorpus(probe, { includeStyles: true });
  // establishedToken() needs style names, and only for styles sharing the typed
  // name — a much smaller question than "every colorway in the catalogue".
  const existing = body.suggest
    ? await prisma.colorway.findMany({
        where: { style: { styleName: { equals: body.suggest.style, mode: "insensitive" } } },
        select: { colorwaySku: true, style: { select: { styleName: true } } },
      })
    : [];

  if (body.suggest) {
    // Reuse the token this style already uses, rather than re-deriving it.
    //
    // No single abbreviation rule fits the corpus. Measured over 115 single-word
    // style names, dropping vowels matches 61% (BARNES->BRNS, COLLUM->CLLM) and
    // taking the first three letters 27% (SIREN->SIR, NELSON->NEL) — two schemes
    // side by side, with KERI appearing as both KRI and KR and one style token
    // literally recorded as "TBD".
    //
    // Re-deriving is therefore how Barnes ended up as both LIV-BAR and LIV-BRNS.
    // Whatever a style is already called, a new colourway of it gets the same
    // token, so drift stops here even where history cannot be undone.
    const established = establishedToken(body.suggest, existing);
    let proposed = established ?? buildSku(body.suggest);
    // If the convention-derived SKU is already taken by a DIFFERENT garment,
    // suffix it rather than handing back something that will be rejected.
    if (corpus.some((c) => c.toUpperCase() === proposed.toUpperCase())) {
      for (let n = 2; n < 50; n++) {
        const next = `${proposed}-${n}`;
        if (!corpus.some((c) => c.toUpperCase() === next.toUpperCase())) {
          proposed = next;
          break;
        }
      }
    }
    return NextResponse.json({
      ok: true,
      proposed,
      derivedFrom: established ? "the style's existing SKUs" : "the naming convention",
      validation: validateSku(proposed, corpus),
    });
  }
  if (!body.sku?.trim()) {
    return NextResponse.json({ error: "sku or suggest is required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, validation: validateSku(body.sku, corpus) });
}


/**
 * The stem this style already uses, with the requested colour and size applied.
 *
 * Returns null for a style the master has not seen, which is the only case where
 * a token has to be invented.
 */
function establishedToken(
  input: SkuInput,
  existing: Array<{ colorwaySku: string; style: { styleName: string } }>
): string | null {
  const wanted = input.style.trim().toUpperCase();
  if (!wanted) return null;

  const siblings = existing.filter(
    (e) => e.style.styleName.trim().toUpperCase() === wanted
  );
  if (!siblings.length) return null;

  // Most-used stem wins, so one odd legacy spelling does not become the rule.
  const counts = new Map<string, number>();
  for (const sib of siblings) {
    const p = parseSku(sib.colorwaySku);
    const stem = [...p.modifiers, p.prefix ?? "", ...p.body.slice(0, 1)]
      .filter(Boolean)
      .join("-");
    // Skip the retired gender-prefixed scheme — it is being retired, not copied.
    if (/^LIV-[MW]$/.test(stem)) continue;
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  if (!counts.size) return null;

  const stem = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const tail = buildSku({ ...input, prefix: "X", brand: undefined, style: "X" })
    .split("-")
    .slice(2)
    .join("-");
  return normalizeSku([stem, tail].filter(Boolean).join("-"));
}
