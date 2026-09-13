# Aligning SKUs across systems — 2026-09-13

Prompted by a constraint that changes the earlier conclusion: **Pio joins central
storage stock on SKU text.** Its export carries an `ext_variant_id` byte-identical
to `sku` in all 3,692 rows, with no id to fall back on. An alias lives in Origio,
and Pio never sees Origio — so wherever a channel's SKU differs from the master's,
central stock cannot reconcile against that channel.

That retires "aliases are enough" as a general rule. The narrower rule:

> Aliases are sufficient between systems that join on **ids** — Sitoo by product
> id, Shopify by ProductVariant and InventoryItem. They are insufficient wherever
> **SKU is the key**. That is Pio, and it makes the channel's SKU load-bearing.

---

## Shopify — was 47 divergent, now 0

| Family | Renamed | Pio units at risk |
|---|---:|---:|
| `LIV-KR-JPN-DWN` | 19 | **298** |
| `LIV-KR-BLCK-LNN` | 15 | 0 |
| `EXT-BS-NPL-TP` | 5 | 0 |
| `EXT-PB-ORSAYTI` | 2 | 0 |

**41 applied, 0 failures**, read back product by product. The linker then cleared
the aliases the renames made stale: **5,303 refs, 0 differing.**

Only Keri Japan Dawn had central stock — 298 units that could not reconcile
between webshop and warehouse. The rest were the same defect waiting for stock.

Two Shopify-only gaps remain, neither a rename failure: Naples sizes **41–44** are
live under the old SKU and absent from Origio entirely, and Orsay **3,5** and
**6,5** keep their commas for the same reason. Both are master coverage gaps.

### The Paraboot "collision" was my own error

I warned that `EXT-PB-ORSAYTI-4.5` was held by another live product. It was not.
One Shopify product carries every Orsay size and **mixes separators inside
itself** — `3,5` and `4,5` alongside `2.5` and `7.5` — and the normalisation I
checked with conflated the two spellings. Renaming made that product internally
consistent rather than creating a clash.

---

## Sitoo — 13 of 8,092 (0.16 %), and only 9 are naming

Cleaner than Shopify, but qualitatively different: **a third of them are not
naming drift at all.** Every one links on a matching barcode, so the link is
sound; the systems simply disagree about what that barcode identifies.

### Naming only — 9 rows, safe to align

| Origio | Sitoo | |
|---|---|---|
| `EXT-PB-BARTH-Homme-*` | `EEXT-PB-BRTH-AM-*` | 5 rows — the doubled-prefix twin |
| `EXT-BKST-BST-STCO-36` | `EXT-BST-STCO-36` | dropped `BKST` |
| `EXT-PF-4-INCN` | `EXT-PF-4-INCN-OS` | `-OS` suffix |
| `LIV-REPS` | `LIV-REPSS-OS` | repair line |
| `EXT-ANY-WLSKCRWB` | `EXT-ANY-15621100-74` | Anonymousism's numeric code |

**None of these nine exists in Pio**, so nothing is at risk today. They can be
aligned when convenient rather than urgently.

### Identity disagreements — 3 rows, do NOT rename

These are data defects. Renaming would paper over a wrong value.

| Origio | Sitoo | Shared barcode | Disagreement |
|---|---|---|---|
| `EXT-NOV-GAT-BLK-41` | `EXT-NOV-GAT-WHT-41` | `8585052170441` | **colour** — black vs white |
| `EXT-KEEN-JAS-BB-40` | `EXT-KEEN-JAS-BB-40.5` | `0195208040573` | **size** — 40 vs 40.5 |
| `EXT-BKST-BST-HR-42` | `EXT-BKST-BST-MNKSD-42` | `4044477046518` | **style** |

`EXT-NOV-GAT-BLK-41` is the one that matters: **it holds 5 units in Pio.** Central
storage says black, the POS says white, and one barcode serves both. This is the
NOV-GAT defect first seen on 11 Sept, now confirmed live in three systems at once.

The other two are the same shape as Cin7's known duplicate-barcode pairs. All
three need a decision about which garment owns the code — not a rename.

---

## Where this leaves identity

| | Refs | Differing SKU |
|---|---:|---:|
| Shopify | 5,303 | **0** |
| Sitoo | 8,092 | 12 (9 naming, 3 defects) |

One spurious alias was cleared: `LIV-CN-BCHK-3XL` was recorded as differing from
itself, because the row I hand-inserted earlier set `externalSku` unnecessarily.
