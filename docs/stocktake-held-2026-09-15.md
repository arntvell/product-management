# Store stock the registry cannot see — 2026-09-15

From the CFO's stocktake: **135 SKUs, 7,520 units, across five shops**, held
because Loom cannot resolve them. Two different causes, and most of it is mine.

| CFO reason | SKUs | Units | What it means |
|---|---:|---:|---|
| `no_loom_variant` | 97 | 7,417 | Loom does not have the product at all |
| `no_sitoo_link` | 38 | 103 | Loom has it, but cannot tie it to Sitoo |

---

## Cause 1 — I excluded store vintage from the registry (86 SKUs, 6,693 units)

The big one, and a mistake in my filter rather than a data defect.

The 86 are **`EXT-VN-*` — in-store vintage**, modelled as category buckets:
"Burberry Shirt", "Band Tee", "Bucket hat", "Aquascutum coat". I excluded them
because `Colorway.kind = AGGREGATE`, reasoning that aggregates are not scannable
garments.

**That reasoning is wrong for a stock registry.** A vintage bucket is exactly what
gets scanned at the till — it is how store vintage is sold. And they are ready:

| | |
|---|---:|
| Barcoded | 86 of 86 |
| Linked to Sitoo | 85 of 86 |
| Archived | 0 |

The same exclusion caught 1 `SERVICE` (370 units), 2 `CONSUMABLE` (331) and
1 `SAMPLE` (1). Across the whole catalogue the non-merchandise class is 158
AGGREGATE variants (144 barcoded, 136 Sitoo-linked), 18 SAMPLE, 71 CONSUMABLE.

The registry is **total stock across all storage units**. If a storage unit holds
it and a till scans it, it belongs in the registry regardless of `kind`.

## Cause 2 — the barcode filter is colorway-level, not variant-level (6 SKUs)

I held back any colorway where *any* size lacked a barcode. One blank size
therefore removes the whole run:

| Colorway | Sizes | Barcoded | Held back |
|---|---:|---:|---:|
| `LIV-BTH-JPN-BLCK-DSK` | 22 | 21 | **all 22** |
| `EXT-NOV-GAT-BLK` | 6 | 5 | **all 6** |
| `EXT-PNT-YS1025NV` | 2 | 1 | all 2 |

`EXT-NOV-GAT-BLK` is self-inflicted: clearing BLK-41's wrongly-held barcode on
13 Sept made the colorway ineligible, so four in-stock sizes vanished from the
registry. Fixing one row's identity should not cost its siblings theirs.

**Fix:** filter variants, not colorways — send every barcoded variant and omit the
blank ones.

## Cause 3 — 38 SKUs are in Loom but genuinely not in Sitoo

All 32 of the pushed ones carry `sitoo_product_id: null`, correctly: **none has a
Sitoo ref, and none exists in Sitoo at all**, checked against the live API (14,714
products) rather than the snapshot. Mostly Cin7-imported stock — `EXT-KNT-WB-*`
Kinto bottles, `EXT-ICHI-*`, `LIV-KR-WHT-LNN-3332`.

So Loom is right to say it cannot link them. They are physically on shop floors,
in the master, and **not in the POS** — which means they cannot be sold at a till
either. This is the known Sitoo create-path gap, now with a unit count against it.

Plus 7 SKUs that are not in Origio at all.

---

## What to change

1. **Include non-merchandise that carries store stock** — AGGREGATE above all.
   The registry's question is "where is this stock", not "is this a garment".
2. **Move the barcode gate from colorway to variant**, so one blank size stops
   costing a whole run.
3. **Create the 38 in Sitoo** — they hold stock nobody can ring up.

1 and 2 are a re-push of roughly 250 variants. 3 is the create path we have been
deferring since 12 September.
