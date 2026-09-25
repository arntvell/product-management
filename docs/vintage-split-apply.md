# Vintage colourway split — what it is, and what it buys us

## The defect

Cin7 puts the size last in a SKU. The importer therefore stripped the last
hyphen segment and grouped on the rest. For sized garments that is right. For
vintage it is wrong, because the last segment is not a size — it is the garment.

`EXT-VN-NW-USBRSHRT` became **size "USBRSHRT" of a product called "RUGBY SHIRT"**.
`VN-ONLN` swallowed 391 separate garments as sizes of one Polo Ralph Lauren shirt.

18 collapsed colourways hold **514 distinct garments**.

## Why the original model did this on purpose — and why that reason no longer holds

`src/lib/master/product-kind.ts` classifies these as `AGGREGATE`, with the
rationale written into the code:

> Store vintage. One SKU rings up any garment of that kind — "Band Tee",
> "Burberry Jacket" — because second-hand items are not barcoded individually.

That premise is now false. All **514 of 514** have a barcode, and all 514
barcodes are **distinct**. They are barcoded individually, which is exactly why
Sitoo carries them as separate SKUs and Loom cannot match them.

`AGGREGATE` does not gate channel eligibility (the same file says so
explicitly), so the label is a symptom, not a blocker.

## What the split actually buys

Being precise, because the number is smaller than it looks:

- **38 of the 514** are on Loom's `sitoo-unmatched-skus.csv` — including
  `EXT-VN-NW-USBRSHRT`, the example that started this.
- The other 476 already reach Loom, but **only under the wrong parent and the
  wrong name**. `EXT-VN-NW-USBRSHRT` is in Loom right now as variant
  `57a29f1a-…` under a product called RUGBY SHIRT. That is why searching Loom
  for it finds nothing — which was the original complaint.

So: 38 rows cleared from the unmatched queue, and 514 garments become findable
and correctly identified. It is a correctness fix first, a backfill second.

## Shape of the fix

Per garment: a new Style + Colorway, both named from the cleaned Cin7 name, both
carrying the variant's own SKU (style name and colourway name are the same for
vintage — one garment, one name, one of it).

**The variant id never changes.** That is what makes this a move rather than a
delete-and-recreate, and it is what lets Loom follow the stock across.

| | |
|---|---|
| variants moved | 514 |
| new styles / colourways | 514 / 514 |
| old colourways withdrawn | 18 |
| with a price from Cin7 | 480 (34 have none) |
| SKU collisions | 0 |
| brand corrections | 6 |

`sizeLabel`/`dim1` → `OS`, `dim2` → null. CONTINUITY (= Loom's Archive) entry per
new colourway; the old CONTINUITY link is deleted deliberately rather than left
for the next sync's cross-colourway cleanup to remove.

## Exceptions and edge cases

- **`EXT-VN-LVSN-BL` / `EXT-VN-LVSN-BK`** (Levis Blue/Black) are left intact.
  They are genuine size runs — the Cin7 names carry the waist ranges:
  `S (23-30)`, `M (31-33)`, `L (34-36)`, `XL (38+)`.
- **The `EXT` colourway is a junk drawer.** `splitSku("EXT-BPHC003")` yielded
  base `EXT`, so six Bon Parfumeur hand creams and soaps ended up filed under
  brand Vintage. They are split out too and their brand corrected from Cin7, but
  they are not vintage garments and the applier drops the inherited
  `productType`/`vendor` ("Blouse", "Vintage" on a hand cream) rather than
  carrying the mistake into the new rows.
- **The five `VPACK25-*` colourways (34 variants) are a scope question, not a
  settled inclusion.** Brand reads "VINTAGE PACK", not "Vintage", and names like
  "25X- BACKPACK" read as 25-unit lots rather than one-of-ones. They have the
  identical structural defect. Including them: 18 colourways / 514 variants.
  Excluding them: 13 / 480.

## Running it

Dry run by default; `--apply` writes. One transaction per parent colourway, so a
failure names exactly which parent is half-done. Idempotent: the move is guarded
on the variant still sitting under the planned parent, so a re-run after a
partial failure is a no-op for what already landed.

```
node scripts/vintage-split/plan.mjs                      # read-only, writes the plan
node scripts/vintage-split/apply.mjs --parent=EXT-VN-NW  # dry run, one parent
node scripts/vintage-split/apply.mjs --parent=EXT-VN-NW --apply
```

## Then the push

Loom asked for `EXT-VN-NW` alone as the probe: 26 new colourways + the withdrawal
of the old one, **in the same push**, with `allow_variant_reparent: true` and an
explicit per-variant `sku`. Expect `variantsMoved: 26`, `variantsCreated: 0`.

All 18 old colourways have a CONTINUITY entry, so none of the withdrawals will be
silently skipped as out-of-season.
