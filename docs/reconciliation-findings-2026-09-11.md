# Cross-platform reconciliation — findings, 2026-09-11

Full read-only snapshot of **Origio, Sitoo, Shopify and Cin7**, reconciled with
stock as the gate. Nothing was written to any system, nothing deployed, no
migration run.

Reproduce with `scripts/reconcile/fetch.py` then `reconcile.py` — every number
below comes out of that code, not from a one-off query.

| System | Records pulled |
|---|---:|
| Origio (master) | 10,265 variants |
| Sitoo | 14,714 products · 38,709 warehouse rows across 17 warehouses |
| Shopify | 6,502 products · 15,460 variants |
| Cin7 | 28,002 products · 16,338 availability rows |

Resolved into **34,129 product identities**, of which **33,772 are merchandise**
and **9,860 have stock somewhere**.

---

## 1. The headline

**Origio holds about half of what the business actually sells.**

Of 9,860 stocked merchandise identities:

| Present in | Count | Share |
|---|---:|---:|
| Cin7 + Shopify + Sitoo — **not Origio** | **3,793** | 38.5 % |
| Cin7 + Origio + Shopify + Sitoo | 2,853 | 28.9 % |
| Cin7 + Origio + Shopify | 1,481 | 15.0 % |
| Cin7 + Origio + Sitoo | 764 | 7.7 % |
| Cin7 only | 397 | 4.0 % |
| other combinations | 572 | 5.9 % |

**4,583 stocked products are missing from Origio entirely** — and 3,793 of those
are in *all three* other systems. There is no ambiguity about whether they are
real: they are sellable, they are stocked, and three systems agree.

Origio cannot be the source of truth for stock while it is unaware of 46 % of the
stocked catalogue.

### Why the hole exists

Structural, not careless. It follows exactly from how the master was populated:

- **Threadflow** holds only current seasons — new software, no history.
- **The Cin7 import** was scoped to `OnHand > 0` at six locations, so anything out
  of stock on import day never crossed.

Sitoo and Shopify kept everything still active. The master's hole is precisely
where those two intake paths fail to overlap.

---

## 2. All findings

Emitted by `reconcile.py` into `snapshots/2026-09-11/findings.json`.

| Finding | Count | What it means |
|---|---:|---|
| `MISSING_FROM_ORIGIO` | **4,583** | Stocked, absent from the master |
| `MISSING_FROM_SITOO` | 1,660 | In Origio with stock, not in the POS |
| `RETIRE_CANDIDATE` | 956 | In Origio, no stock anywhere, not pre-season |
| `MISSING_FROM_SHOPIFY` | 943 | In Origio with stock, not on the webshop |
| `NO_BARCODE` | 270 | In Origio, no barcode in any system, not pre-season |
| `BARCODE_CONFLICT` | 180 | One SKU, systems disagree on the barcode |
| `SKU_CONFLICT` | 134 | One barcode, systems disagree on the SKU |

### 2.1 `MISSING_FROM_ORIGIO` — 4,583

By SKU prefix: 2,429 `LIV`, 1,545 `EXT`, 390 `VN-ONLN`, 70 `CHIMI`, 149 other.
By category: Shirt 712, Jeans 628, Knitwear 255, Jacket 239, T-Shirt 209.
Brands: Livid men 1,309, Livid Femme 693, then Birkenstock, Rototo, Paraboot.

This is not an edge case or a long tail of oddities — it is core Livid product.

### 2.2 `BARCODE_CONFLICT` — 180, and Sitoo is the outlier

Same SKU, different barcode. Which pairs disagree:

| Pair | Count |
|---|---:|
| shopify vs sitoo | 130 |
| cin7 vs sitoo | 112 |
| cin7 vs shopify | 76 |
| origio vs sitoo | 55 |
| origio vs shopify | 21 |

**Sitoo is on one side of nearly every disagreement.** Example — `LIV-BRNS-JPN-DWN-3034`
is `7072536051781` in Cin7, Origio and Shopify, but `7072536087322` in Sitoo. The
conflicts cluster on a handful of styles (`LIV-KR-JPN-GRVL` 19, `LIV-BRNS-JPN-GRVL`
14, `EXT-RW-875` 14), which reads as **a small number of re-barcoding decisions**,
not scattered typing errors. Trace those decisions and most of the 180 resolve at
once.

### 2.3 `SKU_CONFLICT` — 134, and Shopify is the outlier

Same barcode, different SKU — dominated by one style where Shopify uses
`LIV-KRI-DWN-*` and Cin7, Origio and Sitoo all use `LIV-KR-JPN-DWN-*`. A rename
that reached Shopify and nowhere else.

### 2.4 Within-system duplicates

| System | Barcodes on >1 SKU | SKUs appearing >1× |
|---|---:|---:|
| Sitoo | **0** | 0 |
| Origio | 1 | 0 |
| Shopify | **41** | **150** |
| Cin7 | **75** | 1 |

- **Shopify's 41** put two different colourways on one barcode — e.g.
  `LIV-RCHMND-2-PCK-GRML-S` and `LIV-RCHMND-2-PCK-LGHT-GRY-S`. A scan cannot tell
  those apart, so stock movements against them are unreliable at source.
- **Shopify's 150 repeated SKUs** are the same problem from the other direction.
- **Cin7's 75** are `EEXT-`/`EXT-` prefix twins — e.g. `EEXT-PB-BRTH-AM-10` and
  `EXT-PB-BARTH-Homme-10` are one shoe held twice.
- **Sitoo is perfectly clean on both counts.**

### 2.5 Barcode coverage

| System | Coverage |
|---|---:|
| Sitoo | **99.7 %** |
| Cin7 | 97.1 % |
| Shopify | 95.2 % |
| **Origio** | **58.1 %** |

Origio is the outlier by 37 points. Since barcode is the only key all four systems
share, **the master is currently the weakest link in its own reconciliation.**

For identity, Sitoo is presently the better record. That inverts the natural
assumption that the master arbitrates, and it should be settled explicitly before
anyone writes a rule that says "Origio wins".

---

## 3. Applying the stock gate

You asked that anything genuinely gone not be dragged along. Two corrections were
needed before the gate could be trusted:

**Cin7 is also the production system.** It holds buttons, samples and fabric —
one SKU carries 95,598 units, another 27,000. Included, they made every stock
figure meaningless. `NON_MERCH` now excludes those categories.

**Pre-season styles have no stock because they do not exist yet.** A naive gate
produced 4,872 "retire candidates", of which **3,916 were SS27-only** — the entire
coming season. Excluding pre-season leaves **956 genuine candidates**:

| Season membership | Count |
|---|---:|
| Continuity | 301 |
| FW26 + SS27 | 275 |
| FW26 | 266 |
| no season | 107 |
| other | 7 |

Those 956 are in the master, have no stock in Sitoo or Cin7, and are not waiting
on production. They are the safe retire list.

**`PRESEASON` in `reconcile.py` must be updated as seasons move into production**,
or the gate will start proposing to retire real product. This is the single piece
of state in the tooling that goes stale.

---

## 4. Flags that need a human decision

1. **Which of the 4,583 belong in Origio?** They include 390 `VN-ONLN` vintage
   items and a long tail of external brands. My assumption: everything stocked and
   sellable belongs, but vintage may follow the vintage module instead of a bulk
   import, and `STORAGE-`-style rows should not come at all.
2. **Who wins a barcode conflict?** Sitoo is on one side of nearly all 180 and has
   the best coverage — but it is the POS, and a re-barcode there may have been
   local. Needs a rule, not case-by-case guessing.
3. **Shopify's 41 shared barcodes are a live data defect**, independent of this
   project. Two colourways on one barcode means stock movements are already
   unreliable. Worth fixing at source regardless of what Origio does.
4. **Cin7's 75 `EEXT-`/`EXT-` twins** — one product held twice. Which prefix is
   canonical?
5. **`MISSING_FROM_SITOO` (1,660) and `MISSING_FROM_SHOPIFY` (943)** — Origio-held
   stocked product absent from a channel. Some is deliberate (not everything is
   webshop product); some is a gap. Needs a pass with someone who knows the
   merchandising intent.
6. **Cin7's 13,724 vintage records against Origio's 1,610.** The vintage archive
   in Cin7 is roughly 8.5× what the master holds. This connects directly to the
   vintage module (`docs/vintage-drops-integration.md`) and should be decided
   there, not here.

---

## 5. What I did not do

- No writes to any system, no deploy, no migration.
- **No import of the 4,583.** It needs decision 4.1 first, and importing product
  is exactly the kind of bulk write that should be previewed and approved.
- **No conflict resolution.** Needs the rule in 4.2.
- **No UI.** The findings are JSON; a reconciliation surface in Origio is the
  natural next build, reusing the Collections patterns (search, filters, sticky
  header, preview-before-write).

## 6. Suggested order

1. Decide 4.1 and 4.2 — both are rules, not code.
2. Fix Shopify's 41 shared barcodes and 150 repeated SKUs at source; they corrupt
   every downstream join.
3. Import the agreed subset of the 4,583 into Origio, previewed in bulk.
4. Retire the 956.
5. Fill the 270 missing barcodes, and re-run once SS27 goes into production.
6. Build the reconciliation surface; run it on a schedule.
7. Only then push to Loom as the stock registry.
