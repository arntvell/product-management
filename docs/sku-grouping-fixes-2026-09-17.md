# SKU grouping fixes + Loom move support — 2026-09-17

Four changes, all typechecked (`tsc --noEmit` clean), none run against production.

## 1. `splitSku` no longer eats a garment name as a size

`src/lib/cin7/import.ts`. The old rule always stripped the last hyphen segment.
For vintage that segment is the garment, which is how 488 products collapsed into
15 and 473 lost their name.

New rule — a segment is a size only when it **looks** like one, and never for a
one-of-one brand:

```
isSizeToken   XS/S/M/L/2XL…, 7, 41, 7.5, 42,5, 3132, W27, 28/34, XS/S, M/L
ONE_OF_ONE_BRAND  /vintage|used|preloved/i   (the same test grouping.ts uses)
explicit -OS      always splits, preserving  variant_sku == colorway_sku + "-OS"
```

**Shape alone cannot decide it, and I measured that before falling back to the
brand.** `VN-ONLN-4399` is a four-digit token indistinguishable from a
waist+length; 100 of the 391 online-vintage ids parse as a plausible waist and
length under any range test, and a range tight enough to reject them also rejects
three genuine 2-D variants (`1802`, `1042`, `1143`).

A name-comparison rule was tried and **rejected**: it split 92 legitimate size
runs (1,287 variants) on formatting noise alone — `beth japan era, 32l32` (the
size-stripper wants a separator it does not have) and `tia japan indigo 33/32*`
(trailing asterisk defeats the anchor).

Regression-tested against **every** existing multi-variant colorway:

| | |
|---|---|
| stay grouped | 1,806 |
| split | 52 |
| false positives found and fixed | 11 |

The false positives were found by the regression, not by inspection: `M/L` and
`XS/S` are real womenswear labels (6), and `50ml` / `6ml` / `30 ml` / `2XS` are
real sizes on the Abel and Bon Parfumeur runs and the B2B Eplehuset run (5).
`XXXL`, `2XS`, `3XS`, `L16`-style length-only labels and volume/weight units are
now all recognised. All 52 remaining splits are genuine defects — the 15 vintage buckets plus `EXT-BP` (perfumes),
`EXT-RW` (Red Wing care), `EXT-KNT` (Kinto), `2526-1208-*` (buttons) and similar.

## 2. Imperfects group under a parallel `<Style>*`

An imperfect is a different product from the garment it came from, so it must
never join that garment's style. `isImperfect()` keys on **both** markers the
corpus carries — the `IMP-` SKU prefix and a trailing `*` on the Cin7 name —
because neither is complete alone.

Result: **94 imperfect colorway groups nest into 18 styles** instead of 54
one-colorway styles named after a single size.

```
Keri*    IMP-LIV-STY-KERI     22 colorways    Barnes*  IMP-LIV-STY-BARNES  18
Burley*  IMP-LIV-STY-BURLEY    6              Tia*     IMP-LIV-STY-TIA      6
```

The style SKU is built from the name **without** the star and prefixed `IMP-`:
`styleSkuFor` strips punctuation, so `Barnes*` and `Barnes` both render
`LIV-STY-BARNES` and the imperfect style would have silently adopted the real
one. Verified: **0 collisions** with existing style SKUs.

## 3. `colorwayName` handles the imperfect asterisk

The size sits *before* the star — `Barnes Japan Fade, 2932*` — so anchoring on
the size never matched and the size stayed glued to the name. That is why 54
styles are called things like "Barnes Japan Dawn 29/32*". The separator is now
optional too (`29/32`, `29 32`, `29x32`, `32l32` all appear).

**0 of 1,484** imperfect Cin7 products still carry a size or star in the derived
name. `Barnes Black Corduroy 28/32*` → `Barnes Black Corduroy` → colorway
"Black Corduroy" under style "Barnes*".

## 4. Loom: `allow_variant_reparent`, explicit `sku`, real counters

- **`sku` on every variant**, alongside `variant_sku`. Loom derives
  `{colorway_sku}-{suffix}` when `sku` is absent and treats the result as a
  **rename**. That derivation is a no-op today *only* because every colorway SKU
  happens to be the variant SKU minus its last segment — it stops being one the
  moment a variant is re-parented, and would have rewritten the SKU Sitoo matches
  on for all 391. We have never sent a field called `sku`, and history cannot
  tell us which branch we were in, because both produce identical results today.
  Sending both spellings removes the question.
- **`allowVariantReparent`** through `pushColorwaysToLoom` and the route,
  off by default, emitted only when true.
- **The job summary now reads what it always should have**: `variantsCreated`,
  `variantsUpdated`, `variantsMoved`, `variantsMoveRefused`, `pioReparentPending`,
  `pricesCreated`, `pricesUpdated`, `itemErrors`. A push with
  `variantsMoveRefused > 0` no longer reports success — a refused move skips the
  colorway in Loom's preflight, so marking it published would record a state Loom
  does not hold.

## Effect on the pending backfill

The allowlist was **rebuilt** with the new grouping — the first build expanded
"the full size run for each new colorway base" using the OLD rule, which for
vintage meant pulling in every `EXT-VN-NW-*` sibling Cin7 holds. With the new
rule a vintage base is the whole SKU, so there are no siblings to pull:

```
                   before   after
allowlist            2582     2579
colorways             976     1057
toImport              303      422   colorways
toImportVariants     1159     1255
topUp                1423     1324   variants
```

Every vintage SKU in the allowlist is now one Sitoo explicitly asked for —
`EXT-VN-NW-*` 23 of 23, `EXT-VN-*` 49 of 49, `VIN-*` 7 of 7, **0 extra**.

More colorways overall, because vintage no longer collapses into a handful.

## 5. style-splits no longer proposes undoing the imperfect split

`src/lib/master/style-splits.ts` stripped the trailing asterisk in
`nameForMatching`, so `Barnes*` normalised to `barnes` — identical to the real
Barnes style. Pass A matches `matchName` exactly and pass B matches
`startsWith(parent + " ")`, so the report would have proposed merging the
imperfect style straight back into the wholesale one.

The marker now moves to the **front** of the key (`*barnes`), which survives both
passes: it never equals `barnes`, and `*barnes forest fog` never starts with
`barnes `. The promoted parent name keeps the star too — the shared prefix is
computed from raw style names, where the star sits after the size and was lost.

Verified against the live report: **404 proposals, 0 of them mixing an imperfect
style with a regular one.** As a bonus the existing 54 imperfect styles now
cluster correctly and are proposed as `Barnes*`, `Keri*`, `Tia*`, `Beth*` and so
on — so the existing data can be fixed through the review screen, not only new
imports.

## What this does NOT do

The fix prevents **new** collapses. The 488 already in Origio are untouched — the
importer is non-destructive and skips them on variant-SKU match. Splitting the
existing data is the separate repair in `vintage-colorway-collapse.md`, and it
needs Loom's `allow_variant_reparent` and Kristoffer's go-ahead.

Likewise the 54 existing imperfect colorways keep their current one-per-style
shape until the style-splits proposals above are applied — which is a reviewed
action, not part of these changes.
