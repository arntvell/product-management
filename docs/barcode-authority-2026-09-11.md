# Barcode authority and conflict resolution

**Input:** the CFO's barcode list, `snapshots/2026-09-11/worklists/barcodes-2026-09-11.csv`
— 9,822 Livid SKUs, added between 2026-03-30 and 2026-09-03.

**Status:** analysis only. Nothing written to any system.

---

## 1. The list is trustworthy

Validated before being used as an authority:

- **9,822 rows, every EAN-13 check digit valid.** Not one failure.
- **Zero duplicate SKUs, zero duplicate EANs.**
- All 13 digits. 9,748 on Livid's GS1 prefix `7072536*`; 74 on `7000000*`, an
  internal range.

That is cleaner than any of the four systems it is being used to correct.

---

## 2. "Cin7 wins" was the wrong rule — the data says so

The proposed rule was to let Cin7 win a barcode conflict. Measured against the
CFO list, Cin7 is the *least* accurate of the three large systems:

| System | Has a barcode for a CFO SKU | Matches CFO | **Wrong** | Accuracy |
|---|---:|---:|---:|---:|
| Shopify | 5,882 | 5,866 | 16 | **99.73 %** |
| Sitoo | 9,182 | 9,135 | 47 | 99.49 % |
| **Cin7** | 9,340 | 9,291 | **49** | 99.48 % |
| Origio | 3,171 | 3,139 | 32 | 98.99 % |

Of the 180 barcode conflicts, **Cin7 contradicts the CFO list in 45** — and in
those, Sitoo is the one that is right:

```
LIV-KR-JPN-GRVL-2934
   CFO      7072536078641
   sitoo    7072536078641   <- correct
   cin7     7072536084277   x
   origio   7072536084277   x
```

The whole `LIV-KR-JPN-GRVL-*` cluster runs this way. "Cin7 wins" would overwrite
correct barcodes with wrong ones.

It would also be a **no-op for Origio** — zero rows change — because Origio was
populated from the Cin7 import and the two already agree wherever both hold a
value.

**Adopted rule: the CFO list wins for Livid products.**

---

## 3. What the CFO list cannot settle, and why it is not Sitoo either

88 of the 180 conflicts involve SKUs absent from the list. **86 are `EXT-` and 2
are `CHIMI`** — external brands. Their barcodes come from the *brand's own* GS1
prefix (5712828 Form, 8433968 Camper, 7350141 Stutterheim), not Livid's. A
Livid-only list was never going to cover them; this is not a gap in the list.

For those, no single system is authoritative. Under a majority rule the odd one
out is:

| System | Times it is the outlier |
|---|---:|
| Shopify | 46 |
| Sitoo | 26 |
| Cin7 | 13 |

On this count "Sitoo wins" looked wrong 26 times — but see §3a: the count was
inflated by treating Origio and Cin7 as independent when they are identical.

```
EXT-CMP-KRA-BRWN-37
   cin7 = 8433968160226   origio = 8433968160226   sitoo = 8433968160226
   shopify = 8433968158131   <- outlier
```

Majority resolves 85 of the 88; 3 have no majority at all. But majority is a
*proxy for* correctness, not correctness itself — three systems can agree on the
same wrong value, particularly since Origio and Cin7 share an origin. **The real
fix for external brands is the same as the one you just did for Livid: get the
barcodes from the brand.** Until then, majority is a defensible interim.

---

## 3a. Adopted rule: CFO list for Livid, Sitoo for the rest

Settled after testing the alternative. Three things support it:

**Sitoo and Cin7 do agree on externals — 99.05 %** (4,167 of 4,207 where both hold
a barcode). Every pair agrees around 99 %, so disagreement is rare everywhere.

**My earlier majority count was inflated, and the correction favours Sitoo.**
Origio and Cin7 are **100 % identical** (5,903 of 5,903 shared barcodes) because
Origio was populated by the Cin7 import. They are one source of evidence, not two,
and counting both manufactures a 3-against-1 majority out of what is really
2-against-1. Recounted with Cin7+Origio as a single vote, the outlier is Shopify 45
times and Sitoo 24 — so Sitoo is the minority far less often than the first pass
suggested.

**The decisive argument is yours, and it is epistemic rather than statistical.**
Sitoo is the only system where a wrong barcode fails physically: the product does
not scan at the till and someone fixes it that day. Cin7 and Shopify have no such
feedback loop — a wrong barcode can sit in them indefinitely. Of the 24 cases where
Sitoo is the minority, 13 are products with stock in a physical shop, so they have
been exposed to exactly that loop.

### The caveat: Sitoo's barcode is not always the manufacturer's

Inspecting the 24 shows a real pattern — Sitoo sometimes holds a **store-printed
label** rather than the brand's EAN:

```
EXT-NRD-001-SKYM-9
   cin7 / origio / shopify   872236017271   <- Norda's own GS1 prefix (872236)
   sitoo                     990497800682   <- 99* = GS1 coupon/internal range
```

57 Sitoo barcodes sit in internal or restricted GS1 ranges, and 16 of those exist
nowhere else — a label printed in the shop exists only where it was printed.

**Both values are correct, for different questions.** "What scans at the till" and
"what the manufacturer put on the box" are not the same field, and the model has
one slot for them.

For the purpose at hand — reconciling stock movements — **what scans is the one
that matters**, so the rule is right. But the 24 deserve an eyeball before applying,
and if external supplier feeds are ever matched on barcode, the manufacturer's EAN
will be needed as well as the scanning one.

---

## 4. What is missing from the CFO list

Livid-scope SKUs that carry a barcode in a system but are absent from the list:

| System | Count |
|---|---:|
| Shopify | 629 |
| Sitoo | 454 |
| Cin7 | 64 |
| Origio | 7 |

Origio's 7 are worth a look individually — five old-style `LIV-IMP-JNE-*`
imperfects, the repair line item, and a sale bucket, all on the internal
`7000000*` range rather than a real GS1 prefix.

Origio also holds 4,089 Livid SKUs the list does not cover, but **4,082 have no
barcode at all and 4,058 of those are SS27** — pre-season, exactly as expected.
Not a gap.

### And the reverse, which is the bigger number

**6,567 of the 9,822 CFO SKUs are not in Origio at all.** For Livid specifically
the master holds barely a third of what the CFO has barcoded. That is the same
hole as `MISSING_FROM_ORIGIO`, seen from the CFO's side.

---

## 4a. 21 of the 180 "conflicts" were never conflicts

A 12-digit UPC-A and its 13-digit EAN-13 form are the same barcode — the EAN-13
is the UPC-A with a leading zero. Systems store it both ways, and comparing raw
strings made 21 pairs look like disagreements:

```
EXT-PF-4-INCN    cin7 855111006676   shopify 0855111006676   <- identical
EXT-URS-STBRC    sitoo 851081003004  shopify 0851081003004   <- identical
```

Mostly Stutterheim (`EXT-STM-*`) and P.F. Candle (`EXT-PF-*`). `usable()` in
`reconcile.py` now normalises to the 12-digit core and strips invisible
formatting characters, so **the real conflict count is 159, not 180.**

Two of the three no-majority cases dissolved this way. Only `EXT-ANY-JQCR-BR` was
a genuine disagreement (`4550263049538` vs `4550263048012`), resolved to Sitoo.

Recorded in `scripts/reconcile/decisions.json`.

---

## 5. Malformed barcode values

Not conflicts, but they break exact-match joins wherever they appear:

- **`******************mangler`** — in Shopify *and* Cin7. Someone typed the
  Norwegian for "missing" into a barcode field.
- **Embedded Unicode direction marks** — `‭7350141350025‬` in Sitoo,
  Shopify and Cin7; `07350141350230‬` in Shopify. Invisible, and they make
  the value unequal to the same barcode typed cleanly.
- **Single-digit barcodes in Cin7** — literal `1`, `2`, `3`, `4`, `5`, `6`, `7`.
- **~60 nine-digit values** (`333001248`, `333890774`, …) appearing consistently
  across Sitoo, Shopify and Cin7. Consistent, so deliberate — but they are not
  EANs, and whatever they are should be recorded somewhere other than the barcode
  field.
- A 14-digit `70903847293742` in Sitoo and Cin7.

Leading zeros are *not* in this list: a 13-digit code beginning `0` is a converted
UPC-A and legitimate.

---

## 6. Worklists

Under `snapshots/2026-09-11/worklists/`:

| File | Contents |
|---|---|
| `barcode_corrections.csv` | Every change applying the CFO list would make, per system |
| `barcode_conflict_resolution.csv` | All 180 conflicts with the authority that settles each |
| `missing_from_cfo_list.csv` | The 1,154 SKUs above, for the CFO to confirm or add |

Applying the CFO list would mean:

| System | Correct to CFO | Fill a blank | SKU absent from system |
|---|---:|---:|---:|
| Origio | 32 | 84 | 6,567 |
| Sitoo | 47 | 21 | 619 |
| Shopify | 16 | 458 | 3,482 |
| Cin7 | 49 | 258 | 224 |

**Before applying:** Shopify's 458 blanks are the largest single write. Worth
confirming they are unintentionally blank rather than deliberately so, since
Shopify is otherwise the most accurate system in this comparison.
