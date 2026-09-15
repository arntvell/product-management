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

---

## Applied

**Payload:** the barcode gate moved from colorway to variant. A blank size is now
omitted from the delivery instead of removing its whole run.

**Three mis-filed barcodes moved to the row Sitoo names for them** — same shape as
NOV-GAT, release-then-write in one transaction each:

| Barcode | Was on | Now on | Sitoo |
|---|---|---|---|
| `7000000023361` | `LIV-REPS` (in a colorway called "Pickuo") | `LIV-REPSS-OS` | 14238 |
| `4044477046518` | `EXT-BKST-BST-HR-42` (a colorway itself named "Boston Mink Suede") | `EXT-BKST-BST-MNKSD-42` | 15166 |
| `0855111006676` | `EXT-PF-4-INCN` (an incense filed under the candle) | `EXT-PF-4-INCN-OS` | 18714 |

Catalogue still has **0 duplicate barcodes**.

**Push:** 182 colorways · 741 variants · created 136, updated 45, 0 errors. The
`kind` exclusion is gone — the registry now carries anything with a barcode that a
storage unit holds.

### Result against the CFO's list

| | SKUs | Units |
|---|---:|---:|
| **Now in Loom** | **127** | **7,161** |
| Still held | 8 | 359 |

The eight that remain are all explained:

- **`LIV-REPS`, 319 units** — its barcode moved to `LIV-REPSS-OS`, which *is* now in
  Loom with 370 units. The same repair line counted twice under two spellings; the
  stocktake needs to map one to the other.
- **6 × `LIV-Needle-W-*`, 39 units** — see below.
- **`EXT-BS-AMS-CRF-41`, 1 unit** — not in Origio at all.

---

## A blind spot the merge exposed

The Needle merge kept the Threadflow spelling `LIV-NEEDLE-W-*`. **Sitoo still says
`LIV-Needle-W-*`**, and `externalSku` is null — because `normalizeSku` uppercases
before comparing, so the linker sees no divergence at all.

That is fine for us and wrong for everyone who joins on raw text. It is the Pio
lesson again: a difference our normalisation hides is still a difference to a
consumer matching strings, and the stocktake is one.

Measured across all 8,090 linked Sitoo variants:

| | |
|---|---:|
| SKU matches exactly | 8,076 |
| **Differs by case only** | **6** |
| Differs otherwise | 8 |

All six are Needle. Contained, but it means **a merge can silently introduce a
case-only divergence in a channel**, and nothing in the linker will report it.
Worth a check after every merge, and there are 69 pairs still queued.

**Fix:** rename those six in Sitoo to the master's spelling. Not done — it is a
channel write and needs a decision.
