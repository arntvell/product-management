# Barnes Faded Porcelain / Fade Bone — 2026-09-15

Reported: *"Barnes Fade Porcelain on FW26 had somehow got Barnes Fade Bone's SKU,
so it's in Loom with the wrong name but the right SKU. Fixing the name in Loom for
now so we can push orders."* And separately: a Threadflow SKU edit would not sync.

## Origio is right; Threadflow holds the error

The sync did not fail — **it refused, deliberately, and said why**:

```
Threadflow colorway "Fade Bone" (8465e34a, 18 sizes) wants SKU LIV-BAR-FAD-BON,
which is held by "Fade Bone" (CIN7_IMPORT, 12 sizes, 12 barcodes,
seasons CONTINUITY, published to LOOM+SHOPIFY). Nothing was written for our
"Faded Porcelain" (LIV-BRNS-FDD-PRCLN, 19 sizes), so no barcodes moved.
```

Threadflow's colorway `8465e34a` is Origio's **`LIV-BRNS-FDD-PRCLN` "Faded
Porcelain"**. Threadflow now calls that same record *"Fade Bone"* with SKU
`LIV-BAR-FAD-BON` — and that SKU already belongs to a different garment under a
different parent style (`LIV-STY-BARNES`, not `LIV-M-BRNS`).

**The barcodes settle which is which.** Two distinct runs, no overlap:

| | Barcode block | Season |
|---|---|---|
| `LIV-BRNS-FDD-PRCLN` — Faded Porcelain | `70725361173xx` | FW26 + SS27 |
| `LIV-BAR-FAD-BON` — Fade Bone (Cin7) | `70725360981xx` | Continuity |

So they are two garments, Origio has both filed correctly, and the sync protected
that. **The fix belongs in Threadflow:** `8465e34a` should be Faded Porcelain with
`LIV-BRNS-FDD-PRCLN`, not Fade Bone. Until it is, every SS27 sync will skip this
one style and report the same conflict — harmlessly, and the other 570 colorways
still apply.

## The Loom name could not be fixed from here

Re-pushed that colorway alone with a fresh `eventId`, sending
`name: "Faded Porcelain"`. Loom answered **`created 0, updated 0`** — no delta.

So Loom is not taking the name from us. That is consistent with the
`LIV-KR-JPN-BLCK` rejection on 14 Sept, where Loom named a *Threadflow* id as the
"stable colorway" for a SKU we have never sent it. **Loom appears to read
Threadflow directly**, which would also explain the wrong name: it is Threadflow's
current name.

If that is right, correcting Threadflow fixes both the sync and the Loom name in
one move, and nothing more is needed from Origio.

## Also needed

Fade Bone is wanted again for **SS27** (it ran in SS26). It exists in Origio today
only as the Cin7 Continuity row, so it needs an SS27 season entry once the
Threadflow identity is untangled — not before, or the same collision repeats.
