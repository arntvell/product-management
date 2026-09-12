# Three worries, measured

Measured 2026-09-12 against live Sitoo, live Origio, and today's Shopify and
Cin7 snapshots. This is the whole scope of each question, not a sample.

---

## 1. Duplicate products sharing a barcode — cannot happen, and doesn't

**Inside the master: 10,282 barcodes, 10,282 distinct. Zero duplicates.**

`Variant.barcode` is uniquely indexed, so two records cannot share a barcode.
That is enforced by the database, not by discipline.

What *does* exist is the related thing, and it is worth being precise about the
difference: **the same garment under two SKUs, where one twin carries the barcode
and the other carries none**. The index permits that, because nothing is shared.

| | |
|---|---:|
| High-confidence duplicate pairs | **12** |
| Worth review | 58 |
| Vintage name-collisions (one-of-one — NOT duplicates) | 149 |
| Cin7-only twins the import brought in | 14 |

The 12 are all the same shape — a retired `LIV-M-`/`LIV-W-` record shadowing a
modern one, the retired side holding no barcodes and no warehouse stock:

```
LIV-INTL-CLST-OX   keeps the barcodes   ←   LIV-M-NTL-CLST-X   has none
LIV-ID-WHT                              ←   LIV-W-D-WHT
LIV-NAR-WHT                             ←   LIV-W-NR-WHT
```

`/catalog/duplicates` lists them with Pio's warehouse quantity beside each, which
independently confirmed 10 of them.

**So: no duplicate barcodes. 12 duplicate products, identified, with the keeper
already determined.**

---

## 2. Is everything in the master?

### Sitoo — yes, everything that carries stock

**6,625 Sitoo products are absent from Origio by both SKU and barcode. Every one
of them carries zero stock.**

```
absent from the master:          6,625 of 14,714
   ...carrying stock now:            0   (0 units)
   ...zero stock:                6,625
```

That is the answer to the question that matters for the registry. Not one
stocked product in the POS is unknown to the master. A scan today resolves.

### Shopify — no, 2,181 active variants are missing

| prefix | count | what it is |
|---|---:|---|
| `VN` | 1,740 | online vintage — the Friday drops, one-of-one |
| `EXT` | 239 | external brands |
| `LIV` | 176 | Livid |
| `FTGD`, `GFT` | 26 | gift cards and similar |

**80% is online vintage**, which by your own description is a separate line that
lives in Shopify and sells online only. Whether it belongs in the master is the
vintage-module question, not a gap.

The **415 `EXT` + `LIV`** rows are the real remainder.

---

## 3. Barcodes on the wrong size — real, and it is 2 product families

This is the serious one, and the worry is justified.

**69 Origio barcodes are assigned by another system to a different SKU.** Split:

| | |
|---|---:|
| Different product entirely | 60 |
| **Same product, wrong size** | **9** |

The 9, in full:

```
LIV-CN-BCHK-L     origio …068666   sitoo says that is M
LIV-CN-BCHK-M     origio …068659   sitoo says that is S
LIV-HNR-BGST-L    origio …069496   sitoo says that is M
LIV-HNR-BGST-M    origio …069489   sitoo says that is S
LIV-HNR-BGST-XL   origio …069502   sitoo says that is L
EXT-PR-AVR-VLGR-7.5   origio …489698   sitoo says that is 9.5
EXT-KEEN-JAS-BB-40    origio …040573   sitoo says that is 40.5
EXT-PB-ORSAYTI-5.5    shopify writes it 5,5   — comma, not a real difference
EXT-PB-ORSAYTI-4.5    shopify writes it 4,5   — comma, not a real difference
```

So: **2 Paraboot formatting artefacts, 2 isolated cases, and 5 rows belonging to
two shifted size runs** — `LIV-CN-BCHK-*` and `LIV-HNR-BGST-*`. These are the
same two runs found on 2026-09-11 and never fixed.

### Why this matters operationally

Every size below the top carries the next size up's code **in Sitoo**. Origio and
the CFO list agree with each other; Sitoo is the one that is shifted.

**Scanning a Small in the shop rings up a Medium.** Stock decrements on the wrong
size, and it has been doing so for as long as the shift has existed.

### Why it has not been fixed

It is a *rotation*, not a clash. Applied row by row every write collides with the
row above it, and Sitoo enforces barcode uniqueness, so each one is rejected. It
has to be unwound and rewritten as a set — which `pushBarcodesToSitoo` now does,
and which was rehearsed in the sandbox on a six-way rotation.

### What it needs before it is written

**A scan of one garment in each family.** Origio and the CFO agree, which is good
evidence but not proof — and Barnes taught exactly this lesson last week: the CFO
list records what was *allocated*, not what was *printed*. Two stores settled
Barnes in an afternoon.

Scan a `LIV-CN-BCHK` Small and a `LIV-HNR-BGST` Small. If they read `…068642` and
`…069472`, Origio is right and the fix is a 5-row atomic rewrite in Sitoo.

---

## Summary

| Worry | Answer |
|---|---|
| Duplicate products sharing a barcode | **Impossible in the master.** 12 duplicate products exist where one twin has no barcode; keeper already determined. |
| Everything in the master | **Sitoo: yes**, every stocked product. **Shopify: 415 real rows** plus 1,740 online vintage pending the vintage decision. |
| Barcodes on the wrong size | **Real. 2 families, 5 rows, plus 2 isolated.** Sitoo is the shifted one. Needs one scan per family, then an atomic rewrite. |

Worklists: `barcode-wrong-size.csv`, `missing-from-master.csv`,
`same-product-two-skus.csv`, `duplicates-and-missing-barcodes.csv`
(all under `snapshots/2026-09-12/worklists/`).
