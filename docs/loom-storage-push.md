# The STORAGE push — 2026-09-16

**67 colorways requested · 67 created in Loom · 0 skipped, 0 rejected.**

Every `STORAGE-*` record in the master — the internal consumables Cin7 tracked as
stock — into Loom's `STORAGE` season as registry records.

| | |
|---|---:|
| Created | 67 |
| Updated | 0 |
| Archived | 0 |
| Skipped | 0 |

Job `cmu39u8yv000bs60lr0ox94ly`, `status: done`, `unconfirmed: false`.
Delivery `origio-storage-10792d6e-67`. All 67 `ChannelPublication` rows for LOOM
now read `published: true`, `lastPushStatus: ok` — verified after, not assumed.

## The set

67 colorways, all `STORAGE-*`, all CONTINUITY-only, none archived, one `-OS`
variant each, `kind = CONSUMABLE`:

| | |
|---|---:|
| productType `lager` | 42 |
| productType `Storage` | 24 |
| productType `Fitguide` (`STORAGE-CHRISTOPHER`) | 1 |

Brands: LAGER 40, Storage 22, Vintage 3, Unknown 2. **None is Livid's own.**

## Why `data` and not `full`

A dry run in `full` mode skipped all 67 — *"not a Livid-brand product"*. Correct:
packaging, hangtags, shop lighting, swatches and tools are not wholesaled. The
wholesale catalogue was never the target; the registry was.

## What this push changed in the code

The registry sends barcoded variants only — *"a variant with no barcode cannot
reconcile a scan"* — and not one of these 67 carries a barcode. Under the rule as
written every row arrived with `variants: []`: a product Loom cannot hold stock
against, which is the one thing they were being sent for.

`be5e199` exempts `kind = CONSUMABLE` from that filter. Merchandise keeps the
gate. These are counted by hand on a shelf and never scanned at a till, so no
scan will ever need to reconcile against them.

The exemption is keyed on the kind, so it is **wider than these 67**: the
`Fitguide`, `Non-inventory`, `Shopify` and `SAVED` categories also classify as
CONSUMABLE, and they will now pass the barcode gate on any future registry push.
The same argument holds for them, but the archive full push deliberately held
unbarcoded rows back — so this is a rule relaxed, not a special case granted.

## Worth knowing

- **`ChannelPublication` records the channel, not the season.** These 67 now count
  as published to LOOM alongside the 3,974 in `archv`, though they are in
  `STORAGE`. Any figure that reads "in Loom's registry" from Origio alone will
  overstate `archv` by 67 until it learns to split by season.
- **The season name was sent verbatim.** `STORAGE` is not in `LOOM_SEASON_NAMES`
  and needed no mapping, unlike `CONTINUITY → archv`. Loom created 67 products
  under it; which shelf they render on is visible in Loom, not from here.
