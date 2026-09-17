# Sitoo unmatched SKUs → Origio → Loom (2026-09-17)

Input: `sitoo-unmatched-skus.csv` from Loom — 3,853 SKUs Sitoo holds that Loom
cannot match. All `pending`, no barcodes in the file.

## Where the 3,853 actually are

| Bucket | Count |
|---|---|
| Already in Origio, exact SKU | 224 |
| In Origio, matched only after normalisation (decimal comma) | 4 |
| Absent from Origio | 3,625 |

### The 224 that Origio already has

All 145 colorways behind them **already carry a LOOM `ChannelPublication`** —
Loom was sent these products. So this bucket is not an Origio gap.

| kind | barcode | n |
|---|---|---|
| AGGREGATE | yes | 136 |
| MERCHANDISE | yes | 26 |
| MERCHANDISE | **no** | 42 |
| SAMPLE | yes | 16 |
| CONSUMABLE | yes/no | 2 / 1 |
| SERVICE | yes | 1 |

- **42 are explained**: `buildRegistryColorway` emits barcoded variants only
  (CONSUMABLE exempt). No barcode → the size never reached Loom. Fix is a
  barcode, not a push.
- **182 should already be in Loom** and are not. Only 23 of the 145 colorways
  contain a blank-barcode sibling, so the old colorway-level gate explains a
  minority. The rest is unexplained from our side, and Loom's client has no
  product read endpoint — **this is a question for Loom**, not an Origio fix.

### The 3,625 absent from Origio

| | Count |
|---|---|
| Present in Cin7 | 2,042 |
| **Not in Cin7 either** | **1,583** |

Kristoffer's assumption that the missing ones are all in Cin7 holds for about
half. The other 1,583 exist only in Sitoo — that is what
`src/lib/master/import-gaps.ts` was written for, and they cannot be backfilled
from Cin7 at all.

Of the 2,042 in Cin7:

| | Count | Action |
|---|---|---|
| Importable | 2,022 | import |
| No usable barcode in Cin7 | 36 | import, but **will not reach Loom** |
| Barcode already on an Origio variant | 16 | exclude — duplicate |
| Proven-renamed colorway, same size | 9 (EEXT + 1) | exclude — duplicate |
| Fabric / gift card | 2 | exclude |

**Kind is not an exclusion here.** `product-kind.ts` says in caps that AGGREGATE
describes shape, not saleability (89 of 108 aggregate colorways are in the POS),
and `isLoomEligible("registry")` returns true for everything because stock that
does not reach the registry does not reconcile. Origio already holds AGGREGATE,
SAMPLE, CONSUMABLE, SERVICE and MATERIAL colorways and **every one of them has a
LOOM publication**. So vintage buckets, sale buckets and samples are admitted.
Two rows are genuinely not product and are denied: `LIV-SKR-FBRC` (fabric) and
`GFTCRD`. The nine `LIV-FullSkirt-*` rows sit in Cin7 category `Stork` but are
plainly garments (Japan Marine / Needle Grey, XS–XL) and are admitted.

## The duplicate check

Kristoffer was right to ask. Barcode is the only reliable signal — `sku.ts`
records that string similarity produced 17,277 false pairs and was abandoned,
and `compareSku` accordingly matched **0** of the 3,625 (abbreviation renames
like `LIV-KRI-JP-BK` vs `LIV-KR-JPN-BLCK` are invisible to it by design).

Matching Cin7 barcodes against `Variant.barcode` found **5 renamed colorways**:

| Sitoo spelling | is really | proven by |
|---|---|---|
| `LIV-KRI-JP-BK` | `LIV-KR-JPN-BLCK` | 2 sizes |
| `LIV-ML-WHT` | `LIV-W-ML-WHT` | 3 sizes |
| `EEXT-PB-BRTH-AM` | `EXT-PB-BARTH-Homme` | 5 sizes |
| `EXT-BKST-NPLS-WRPPD-SD-TP-BG` | `EXT-BS-NPL-TP` | 4 sizes |
| `EXT-HST-EML-OFGR` | `EXT-HST-EML-OF` | 1 size |

Propagating each proven rename across its whole size run flags **38** Sitoo SKUs,
of which **33** are certain duplicates (Origio already holds that exact size
under the other name). Importing them would have created 5 duplicate colorways.
They are in `denySkus`.

`EEXT-` is a known prefix typo for `EXT-` (`PREFIX_TYPOS` in `sku.ts`), so the
whole `EEXT-` family is denied.

Also found: **Sitoo writes half-sizes with a comma** (`42,5`) where Cin7 and
Origio use a dot (`42.5`). 18 SKUs affected, 4 of which already exist in Origio
and are only "missing" because of the separator. `normalizeSku` does not handle
this — worth adding.

## The import

Allowlist: `snapshots/sitoo-backfill-allowlist.json` — 2,582 allow, 27 deny.

Built from the 2,022 importable Sitoo-driven SKUs, then **expanded to the full
Cin7 size run for each new colorway base** (+561 siblings), because
`cin7/import.ts` warns that a half-populated size run is worse than an absent one.

A **barcode sweep runs over the final list**, not just the Sitoo-driven part.
That matters: one duplicate (`EXT-BS-NPL-TP-36`) existed only among the
expansion siblings and would otherwise have been created barcodeless — the
importer downgrades a barcode collision to "create without barcode" and the
preview does not surface `barcodeConflicts`, so it would have landed as a silent
duplicate that cannot sync stock.

Two Cin7 self-twin barcodes are deliberately left in (`EXT-SP-SPLO-OKE-50ml` /
`-150ml` — two real products, one wrong barcode upstream). The importer reports
them in `barcodeConflicts`.

Dry run (`POST /api/catalog/import/cin7 {dryRun:true, allowlist}`):

```
gate            allow 2582 / deny 27
productMissing  0
colorways       976
toImport        303 colorways, 1159 variants
topUp           1423 variants onto 673 existing colorways
wouldDrop       0        lifecycleReconciled false
```

All 673 top-up parents are `source='CIN7_IMPORT'` — none Threadflow-owned, so
nothing here is at risk of being undone by the next TF pull.

`lifecycleReconciled: false` is what we want — an allowlist is additive and says
nothing about the rest of the catalogue; reconciling from one would cancel
thousands of live colorways.

Nesting, colorway naming (family name minus style name) and the CONTINUITY
season entry are all handled by `cin7/import.ts` — `deriveParentStyle` matches
against Threadflow's style vocabulary and mints a parent only when nothing fits.
Minted styles come back in `mintedStyles` and want review in `/catalog/style-splits`.

## Then the Loom push

`mode: "data"` (registry), season `CONTINUITY` → Loom `archv`, scoped to the
newly imported colorway ids, `dryRun` first, explicit `eventId`.

`data` mode is correct here: registry purpose makes everything eligible
(externals and vintage included), there is no readiness gate, and prices ride
along where they exist. `full` would drop every non-Livid brand.

Prices come from Cin7 `PriceTiers` where present; absent prices are fine per the
brief.

## Known limits

- The 1,583 Sitoo-only SKUs are **not addressed** by this import.
- The 36 barcodeless imports will land in Origio and **not** reach Loom.
- The 1,583 cannot be duplicate-checked at all — no barcode in the CSV and no
  Cin7 record to take one from.
