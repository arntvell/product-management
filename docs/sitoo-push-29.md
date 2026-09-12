# The 29 outstanding Sitoo barcode writes

What a live push would change, as of 2026-09-12. Nothing applied yet.

Rehearsed against the sandbox — 29/29 written, no products lost, no variant
family changed size (`scripts/sitoo/rehearse.py`).

Machine-readable: `snapshots/2026-09-11/worklists/sitoo-push-29.csv`

---

## Batch 1 — 11 changes

Sitoo holds a barcode that disagrees with the master. These are the ones worth
checking at a till afterwards: a wrong barcode here means the product either
does not scan or rings up as something else.

| SKU | Sitoo id | Before | After | Product |
|---|---|---|---|---|
| `LIV-ARMND-BLCK-L` | 17470 | 7072536086844 | `7072536081993` | Armand Black |
| `LIV-ARMND-BLCK-S` | 17479 | 7072536086820 | `7072536082013` | Armand Black |
| `LIV-ARMND-BLCK-XS` | 17480 | 7072536086813 | `7072536082020` | Armand Black |
| `LIV-HF-CHMRN-2XL` | 13779 | 7072536068260 | `7072536068864` | Huff Charcoal Fluid Merino |
| `LIV-HF-CHMRN-XL` | 13784 | 7072536068253 | `7072536068857` | Huff Charcoal Fluid Merino |
| `LIV-ML-WHT-L` | 11447 | 7072536057141 | `7072536069106` | Mila White |
| `LIV-TK-WHT-SLK-L` | 17477 | 7072536090438 | `7072536086929` | Tiki Silk White |
| `LIV-TK-WHT-SLK-M` | 17504 | 7072536090421 | `7072536086912` | Tiki Silk White |
| `LIV-TK-WHT-SLK-S` | 17505 | 7072536090414 | `7072536086905` | Tiki Silk White |
| `LIV-TK-WHT-SLK-XL` | 17506 | 7072536090445 | `7072536086936` | Tiki Silk White |
| `LIV-TK-WHT-SLK-XS` | 17507 | 7072536090407 | `7072536086899` | Tiki Silk White |

Three families, and each is a whole size run rather than a stray row — which
reads like a re-barcoding that reached the master and not the POS, the same
shape as the Barnes case.

## Batch 2 — 18 fills

No barcode in Sitoo at all today, so these cannot be scanned. Lower risk:
nothing is being overwritten.

| SKU | Sitoo id | Barcode | Product |
|---|---|---|---|
| `EXT-FRM-HRHL-OS` | 14397 | `5712828116041` | Herbarium Hand Lotion 375 ml |
| `EXT-FRM-HRHW-OS` | 14396 | `5712828116003` | Herbarium Hand Wash 375 ml |
| `IMP-LIV-T-JPN-NW-BL-3434` | 19969 | `7072536116183` | Tia Japan New Blue* |
| `IMP-LIV-T-VPR-2432` | 19627 | `7072536116190` | Tia Vapor* |
| `IMP-LIV-T-VPR-2532` | 19970 | `7072536116206` | Tia Vapor* |
| `IMP-LIV-T-VPR-2634` | 19973 | `7072536116237` | Tia Vapor* |
| `IMP-LIV-T-VPR-2732` | 19974 | `7072536116244` | Tia Vapor* |
| `IMP-LIV-T-VPR-2734` | 19975 | `7072536116251` | Tia Vapor* |
| `IMP-LIV-T-VPR-2834` | 19977 | `7072536116275` | Tia Vapor* |
| `IMP-LIV-T-VPR-2932` | 19978 | `7072536116282` | Tia Vapor* |
| `IMP-LIV-T-VPR-2934` | 19979 | `7072536116299` | Tia Vapor* |
| `IMP-LIV-T-VPR-3032` | 19980 | `7072536116305` | Tia Vapor* |
| `IMP-LIV-T-VPR-3034` | 19981 | `7072536116312` | Tia Vapor* |
| `IMP-LIV-T-VPR-3132` | 19982 | `7072536116329` | Tia Vapor* |
| `IMP-LIV-T-VPR-3134` | 19983 | `7072536116336` | Tia Vapor* |
| `IMP-LIV-T-VPR-3232` | 19984 | `7072536116343` | Tia Vapor* |
| `IMP-LIV-T-VPR-3234` | 19985 | `7072536116350` | Tia Vapor* |
| `IMP-LIV-T-VPR-3332` | 19986 | `7072536116367` | Tia Vapor* |

Sixteen of these are Tia Vapor imperfects. They are `IMP-` products — sold at a
discount and deliberately distinct from the garments they came from, so they get
their own barcodes rather than sharing.

## Not in the 29

| | |
|---|---|
| 5 Norda | Sitoo holds a shop-printed `99*` code that actually scans; the master holds the manufacturer EAN. The writer refuses to replace one with the other. `barcodealiases` would let both scan — needs a decision. |
| Barnes / Hayes | Settled 2026-09-12. Nothing outstanding. |

## Checking afterwards

```bash
curl -sX POST localhost:3000/api/catalog/push/sitoo -d '{"dryRun":true}' | jq '.writes | length'
```

Zero means everything landed. Then scan one of each Batch 1 family at a till —
Armand, Huff and Tiki — since those are the rows where a mistake would show up
in a shop rather than in a report.
