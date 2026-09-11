# Duplicate products and SKU drift — what the cleanup actually is

Written after investigating "duplicate products with different SKUs". The scope
turned out to be much smaller than the raw counts suggested, and two genuinely
serious problems surfaced that were hidden underneath them.

---

## 1. Shopify's duplicates were mostly archived history

The first pass reported **41 duplicate barcodes in Shopify**. Scoped to live
products, it is **2**.

39 were archived predecessors. The pattern is consistent and benign:

```
Keri Black Linen   DRAFT      handle keri-black-linen     LIV-KRI-BLKLN-*
Keri Black Linen   ARCHIVED   handle keri-black-linen-1   LIV-KR-BLCK-LNN-*
```

Shopify re-creates a product, the handle gains a `-1` suffix, the new record adopts
a different SKU scheme, and the old one is **archived rather than deleted**. 189
handles carry that numeric suffix.

**7,523 Shopify SKUs exist only on archived products** — nearly half of Shopify's
15,460 variants. Counting them as "present in Shopify" distorted several earlier
findings, all now corrected:

| Finding | Counting archived | Live only |
|---|---:|---:|
| Duplicate barcodes in Shopify | 41 | **2** |
| `BARCODE_CONFLICT` | 159 | **132** |
| `SKU_CONFLICT` | 152 | **69** |
| Shopify blanks to fill | 458 | **197** |
| Withheld collisions | 47 | **13** |

`reconcile.py` now records archived Shopify rows as a separate `shopify_archived`
system: visible as history, excluded from presence, duplicates and conflicts.
A new `SHOPIFY_ARCHIVED_ONLY` finding (385) captures products that exist in Shopify
but only in retired form.

**So the Shopify "cleanup" is not 41 merges.** It is 2 live duplicates, plus an
optional tidy of 2,258 archived products if you want them gone.

---

## 2. Cin7's 75 are real

Cin7 has no archived state in the feed — every one of its 28,002 products reports
`Status: Active` — so its 75 duplicate barcodes are live. Two patterns:

| Pattern | Count | Example |
|---|---:|---|
| Same first characters, then diverge | 49 | `EXT-BKST-BST-HR-42` / `EXT-BKST-BST-MNKSD-42` |
| `EEXT-` vs `EXT-` prefix | 26 | `EEXT-PB-BRTH-AM-10` / `EXT-PB-BARTH-Homme-10` |

The `EEXT-` set is the clearest: one shoe, two records, differing only in a doubled
prefix and an abbreviation (`BRTH-AM` vs `BARTH-Homme`). These are the real merge
candidates — **75 pairs, 75 redundant records.**

---

## 3. Two problems the duplicates were hiding

Both surfaced from collisions the resolver refused to apply. Neither is a
duplicate; both are worse.

### 3.1 Sitoo has a size run shifted by one

```
                 CFO             Sitoo
LIV-CN-BCHK-S    7072536068642   7072536068659   <- this is M's code
LIV-CN-BCHK-M    7072536068659   7072536068666   <- this is L's code
LIV-CN-BCHK-L    7072536068666   7000009888889   <- an internal placeholder
LIV-CN-BCHK-XL   7072536068673   7072536068673   correct
```

Every size below XL carries the next size up's barcode. **In the shop, scanning a
Small rings up a Medium.** `LIV-HNR-BGST-*` has the same shape.

This is a *rotation*, not a clash: applied as a set it resolves cleanly, but applied
row by row every step collides with the row above it — which is why the guard
blocked it. Fixing it needs the whole size run written atomically.

### 3.2 Two different garments claim the same barcode block

```
CFO says    LIV-HYS-TP-28/34        = 7072536087254   (Hayes Suitpant Taupe)
Sitoo has   LIV-BRNS-JPN-DWN-2932   = 7072536087254   (Barnes Japan Dawn)
Sitoo has   LIV-HYS-TP-28/34        = 7072536094191
```

The whole `7072536087*` block is assigned to Hayes Suitpant by the CFO and to Barnes
Japan Dawn by Sitoo. This runs across at least 8 sizes, and it also explains the
`LIV-BRNS-JPN-DWN-*` cluster that dominated the original barcode conflicts — Cin7,
Origio and Shopify all hold `7072536051*` for Barnes.

**This one cannot be settled from data.** Either Sitoo mislabelled Barnes with
Hayes's codes, or the physical garments carry `7072536087*` and the CFO list is out
of step with what was actually printed. The only way to know is to **scan a Barnes
Japan Dawn in a shop and see what comes up.**

Until then the resolver withholds these rows rather than guessing.

---

## 4. How to sort the cleanup

In order of value, and with the cheap structural work first.

**1. Decide the SKU convention, then enforce it at the source.** Every duplicate
here exists because the same garment was entered twice under two spellings —
`KRI` vs `KR-JPN`, `BRTH-AM` vs `BARTH-Homme`, `EEXT-` vs `EXT-`. No amount of
merging prevents the next one. The master should own SKU assignment and the other
systems should receive it.

**2. Merge Cin7's 75.** They are live, real, and `colorways/merge` already exists
on the Origio side with a dry run and preview. Cin7 itself needs its own merge, but
the pair list is known.

**3. Resolve the two live Shopify duplicates**, and separately decide whether to
delete 2,258 archived products. They are inert but they make every analysis lie
until they are excluded — as they did here.

**4. Physically verify §3.2** before writing any barcode in that block.

**5. Apply §3.1 as an atomic size-run rewrite**, not row by row.

**6. Then, and only then, treat the master as the source of SKUs** — which is what
makes step 1 stick.

---

## 5. What this changes about earlier conclusions

- Shopify's duplicate-product problem was **overstated 20×** (41 → 2).
- Shopify's blank barcodes were **overstated 2.3×** (458 → 197 live).
- Shopify's apparent accuracy advantage in the barcode comparison was measured
  across archived rows too, so it should be re-derived before being relied on.
- The `SKU_CONFLICT` count halved once archived rows stopped being compared with
  live ones.

The lesson worth keeping: **"present in a system" needs a lifecycle qualifier.**
Origio has `archived`, Shopify has `status`, Cin7 has neither in this feed. Any
reconciliation that ignores that will systematically overstate both duplication and
coverage.
