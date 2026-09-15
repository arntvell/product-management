# The twin merges kept the wrong SKU — 2026-09-15

## What I did wrong

`merge-colorways.ts` encodes one rule for the survivor: **the row that already
holds the SKU Threadflow wants.** It is a good rule and I applied it to eleven
Threadflow/Cin7 twins without checking whether Threadflow's SKU was the *right*
one.

It was not. For Siren, the correct SKU is the Cin7 spelling
`LIV-SRN-JPN-BLCK-DSK` — it is what Pio holds 137 units against. I promoted the
Threadflow row `LIV-W-SRN-JPN-BLCK-DSK`, which was an empty shell with no barcodes
and no Loom presence, and retired the correct one.

Across all eleven, Pio holds **330 units under the Cin7 spellings and zero under
the Threadflow ones.** The evidence was there before I started; I measured it only
after Loom refused the withdrawal.

## The rule, corrected

> The survivor is the row holding the SKU **the business uses** — which is the one
> carrying stock in Pio and barcodes in the channels. Threadflow's spelling is
> evidence of what Threadflow will try to write next, not of what is right.

Where the two disagree, **Threadflow is what needs correcting**, exactly as with
Barnes Faded Porcelain. Otherwise the next sync undoes the fix — verified: an SS27
dry run plans `LIV-SRN-JPN-BLCK-DSK -> LIV-W-SRN-JPN-BLCK-DSK` today.

## Where it stands now

The merges themselves stand — one row per garment, barcodes and channel refs
consolidated, seasons and prices moved. Only the surviving SKU was put back:

| | |
|---|---:|
| Colorways renamed back | 11 |
| Variants renamed back | 74 |
| Duplicate barcodes | **0** |
| Duplicate variant SKUs | **0** |
| **Pio rows resolving to a live Origio SKU** | **49 of 49 (330 units)** |

Origio and Pio agree again.

## What is still broken, and where

**Loom.** It archived the eleven Cin7 records during the withdrawal, and now
refuses to let the surviving rows reclaim those SKUs:

```
LIV-SRN-JPN-BLCK-DSK: variant SKU LIV-SRN-JPN-BLCK-DSK-2432 is owned by
stable variant 7e058816-…; merge or correct that identity before renaming
```

`7e058816` is the archived variant. Loom binds a SKU to a variant id and will not
release it to another, so **this cannot be repaired from Origio** — it needs Loom
to un-archive those eleven records or re-key them to the surviving ids. Same family
as the `LIV-KR-JPN-BLCK` stable-id conflict from 14 September.

**Threadflow**, for the eleven SKUs above — otherwise the next sync reverts them.

## Guard worth building

The merge preview should refuse, or at least warn, when the loser's SKU carries
stock in Pio and the survivor's does not. That single check would have caught this
before the first write, and there are ~70 merges still queued behind it.
