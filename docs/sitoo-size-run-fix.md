# Fixing the two shifted size runs in Sitoo — 2026-09-13

Applied and verified. This is the correction that made a Small ring up as a
Medium at the till.

---

## The decision

**The CFO list is the authority for Livid barcodes.** Settled 2026-09-13.

It was not settled from data alone, and it did not need to be: the same shape had
already been decided once. On 12 Sept two stores confirmed by phone that the
physical labels on Barnes Japan Dawn carried `7072536051*` while Sitoo held
`7072536087*` — Sitoo was the system out of step, and the garments agreed with
the CFO list. These two families are the same defect with the same resolution.

Origio already agreed with the CFO list on **all ten rows**, so nothing in the
master changed. All ten now carry the attribution:

```
authority  cfo-list-2026-09-11
evidence   shifted size run in Sitoo; CFO list adopted as authority 2026-09-13,
           Origio already agreed on all 10 rows
```

## What was wrong

Every incorrect Sitoo value was **the next size up's code**, and each run ended
in a shop-printed placeholder:

| | CFO = Origio | Sitoo held | |
|---|---|---|---|
| `LIV-CN-BCHK-S` | `7072536068642` | `7072536068659` | M's code |
| `LIV-CN-BCHK-M` | `7072536068659` | `7072536068666` | L's code |
| `LIV-CN-BCHK-L` | `7072536068666` | `7000009888889` | placeholder |
| `LIV-HNR-BGST-S` | `7072536069472` | `7072536069489` | M's code |
| `LIV-HNR-BGST-M` | `7072536069489` | `7072536069496` | L's code |
| `LIV-HNR-BGST-L` | `7072536069496` | `7072536069502` | XL's code |
| `LIV-HNR-BGST-XL` | `7072536069502` | `7000009888888` | placeholder |

The two placeholders are `7000009888889` and `7000009888888` — consecutive, and
**neither has a valid EAN-13 check digit**, which is why the plan showed them as
`from: null`. They were never scannable. That reads as one person entering a size
run one row off, reaching the end, and printing a label to fill the last slot.

## Why it could not be written row by row

S's target was held by M, M's by L. Sitoo enforces barcode uniqueness, so each
write would have been rejected by the row above it. The push unwinds first —
**5 unwinds, then 7 writes.**

## Verification

Rehearsed against the sandbox first, as the runbook requires. The rehearsal
replays a *heavier* shape than this run — 29 writes across 7 families, 15 of them
into a single 19-child family, with no delay:

```
sandbox BEFORE 570 products, 193 families
applied 29/29 in 8.4s, failures=0
sandbox AFTER  570 products, 193 families
  products LOST: 0 · families that changed size: none · barcodes correct: 29/29
```

Then applied live: **7 applied, 0 failures**, and read back from Sitoo product by
product:

| | |
|---|---|
| All 11 products in both families | **correct, 11/11** |
| Sitoo product count before / after | 14,714 / **14,714** — delta 0 |
| Duplicate barcodes in Sitoo | **0** |
| Variant families | 2,912, none changed size |

Nothing was lost. That check exists because 13 Barnes Japan Dawn products
disappeared during the push on 12 Sept, and the cause is still unknown — Sitoo's
audit log on ids 473–485 would settle it, and it is still worth asking for.

## One loose end

`LIV-CN-BCHK-3XL` (`7072536068697`) is in the CFO list and in Sitoo, but **not in
Origio**. A missing size in the master, not a barcode problem.
