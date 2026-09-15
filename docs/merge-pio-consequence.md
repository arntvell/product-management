# Merging renames SKUs, and Pio cannot follow — 2026-09-15

The 11 Threadflow/Cin7 twin merges are correct in the master and **orphaned 330
units of central-warehouse stock.** That is my error, and the shape of it is worth
recording because it will recur on the 70 merges still queued.

## What happened

Each merge kept the Threadflow SKU and parked the Cin7 one — the rule the merge
module encodes, and the right one, because Threadflow will otherwise recreate its
spelling on the next sync. Barcodes, channel refs, seasons and prices all moved
correctly; catalogue integrity is intact (0 duplicate barcodes, 0 refs on
tombstones, 0 channel record claimed twice).

Then the Loom push withdrew the 11 tombstones, and **Loom refused to finish
quietly**:

```
pio LIV-SRN-JPN-BLCK-DSK-2632: archived in Loom but kept in Pio (kept_has_stock)
… 48 more
```

Loom talks to Pio. Pio holds stock under the **old Cin7 SKUs**, joins on SKU text,
and has no idea the master renamed anything.

| | |
|---|---:|
| Pio rows under the now-archived SKUs | **49** |
| Units stranded | **330** |
| Units under the new survivor SKUs | **0** |

## Why I should have caught it

The Pio constraint was established on 13 September and I acted on it once —
renaming 41 Shopify SKUs *to match the master* precisely because Pio joins on text.
I then ran eleven merges that **change the master's own SKU** without asking the
same question. The rule I wrote down was "aliases are insufficient wherever SKU is
the key"; a merge is the other side of that coin and I did not connect them.

Loom caught it. Nothing was lost — the stock is still in Pio under its old name,
and the barcodes are unchanged throughout, which is what makes the remap safe.

## The remap

`~/Downloads/pio-remap-2026-09-15.csv` — 49 rows, all matched, each carrying the
barcode so the mapping can be verified independently of either SKU:

```
pio_sku                     units  new_sku                        barcode
LIV-SRN-JPN-BLCK-DSK-2832      24  LIV-W-SRN-JPN-BLCK-DSK-2832    7072536093767
```

Once Pio is remapped, re-push the survivors and the withdrawal completes cleanly.

## Stop before the next 70

**No further merges until there is an agreed path for Pio.** Each one renames SKUs
and strands whatever central stock sits under the old name. The options, none of
which is mine to choose:

1. **Remap in Pio each time** — correct, manual, and someone has to do it.
2. **Merge toward the SKU Pio already holds** — keeps central stock intact, but
   Threadflow recreates its spelling on the next sync and the split returns.
3. **Give Pio the barcode as its join key** — the real fix, and the only one that
   makes renames safe permanently. Barcode survived every rename in this whole
   cutover; SKU has not.

A useful guard in the meantime: the merge preview should check Pio for stock under
the loser's SKU and report it as a blocker, the same way it already refuses a
published loser.
