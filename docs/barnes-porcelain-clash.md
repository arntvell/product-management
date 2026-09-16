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

---

## Addendum — 2026-09-16: the conclusion above is superseded

**The fix was never in Threadflow, and Threadflow has since been corrected.**
Re-checked against the live TF API and the Origio database today. What the
2026-09-15 analysis got wrong was the identity of TF colorway `8465e34a`.

Threadflow today returns:

| Season | SKU | Name | TF colorway id |
|---|---|---|---|
| SS27 | `LIV-BAR-FAD-BON` | Fade Bone | **`8465e34a-41df-459e-9575-7f7dbd40fefa`** |
| FW26 | `LIV-BRNS-FDD-PRCLN` | Faded Porcelain | **`fcef36bb-159a-4380-ad4d-92586a399bc9`** |

Both under style `LIV-M-BRNS`. So `8465e34a` is **SS27 Fade Bone** — a genuinely
different garment from Faded Porcelain, and never Faded Porcelain at all.

Origio's `LIV-BRNS-FDD-PRCLN` row nevertheless carries `threadflowId =
8465e34a`. Nothing holds `fcef36bb`. That is the whole bug.

### How the binding got crossed

SS27 Fade Bone was first created in Threadflow carrying **Faded Porcelain's
SKU** (the known data-entry mistake). `resolveColorway` matches
`byTf ?? bySku` — with no TF id on file it fell through to the SKU, landed on
Origio's Faded Porcelain row, and stamped Fade Bone's TF id onto it.

Threadflow's SKU has since been corrected to `LIV-BAR-FAD-BON`. **Correcting the
SKU upstream does not unbind anything.** The next sync now matches by *TF id*
straight onto the Faded Porcelain row and tries to rename it and move it onto
Fade Bone's SKU — which the Cin7 row holds. The refusal is the sync protecting
two live records, exactly as designed. It will repeat forever until the binding
is repointed.

### Proof, not inference

The SS27 `Price` rows on the Faded Porcelain row are Fade Bone's, to the øre:

```
SS27 on LIV-BRNS-FDD-PRCLN   NOK 2600/963  EUR 250/92  GBP 190/70
                             HKD 2080/770  JPY 43335/16050
                             USD 315/126   USD_DAP 280/104
TF SS27 LIV-BAR-FAD-BON      identical, every pair
```

Its own FW26 prices differ (USD 310/124, EUR ws 93, JPY 41935/15532), so this is
not a coincidence of a shared price sheet. The SS27 `SeasonEntry`
(`cmrjkks6n00ejkyc9p3mccw6k`, origin CARRYOVER) carries **no `FieldOwner` lock**,
and TF's SS27 does not contain Faded Porcelain at all.

### The fix — two fields, in Origio

```sql
BEGIN;
UPDATE "Colorway" SET "threadflowId" = 'fcef36bb-159a-4380-ad4d-92586a399bc9'
 WHERE id = 'cmrjkks3a00eikyc9qn0vfvuh';   -- Faded Porcelain → its real TF id
UPDATE "Colorway" SET "threadflowId" = '8465e34a-41df-459e-9575-7f7dbd40fefa'
 WHERE id = '527683a2-1c31-4622-8e74-4a5008877284';  -- Fade Bone → SS27's TF id
COMMIT;
```

Order matters: `threadflowId` is `@unique`, so Porcelain must release the id in
the same transaction that Fade Bone takes it.

**No manual "move Fade Bone to SS27" is needed.** Once bound, the SS27 sync does
the rest by itself: it re-parents the row from the Cin7 style `LIV-STY-BARNES`
onto TF's `LIV-M-BRNS` (`buildColorway` spreads `styleId` into the update
branch), creates the SS27 `SeasonEntry`, and writes all 14 SS27 price rows.

### Why the merge lands cleanly

TF's SS27 Fade Bone variant SKUs and barcodes match the Cin7 row exactly:

- 12 of TF's 18 sizes already exist on the Cin7 row, same `variantSku`, same
  barcode (`70725360981xx`/`0982xx`) — updated in place, nothing moves.
- 6 are new: `-2732`, `-2832`, `-2934`, `-3632`, `-3834`, `-4034`. Only `-3632`
  arrives with a barcode (`7072536098175`); the other five have none yet.

That the barcodes agree on all 12 overlapping sizes confirms the Cin7 row and
TF's SS27 Fade Bone are the same garment, so binding them is a merge, not a
collision.

### Left over afterwards — needs a decision, not a script

After the repoint the SS27 sync stops touching Faded Porcelain, so Fade Bone's
data already written onto that row stays there:

- the SS27 `SeasonEntry` and its 14 SS27 `Price` rows (listed above);
- a Loom publication last pushed 2026-09-15 `ok`, so those prices may be sitting
  on Faded Porcelain's Loom shelf.

Deleting them is the likely right call, but it is a business decision — confirm
Faded Porcelain is genuinely not an SS27 product first.

Separately, the Porcelain row has 19 variants where TF's FW26 Porcelain has 15.
The 4 extra (`-2732`, `-2832`, `-3632`, `-4034`, all unbarcoded) are sizes in
Fade Bone's run. They were all created in the same pass on 2026-07-13, so this is
**not** proven to be residue from the crossed binding the way the prices are —
flagged, not concluded.

### Applied 2026-09-16 — verified by dry-run

The repoint was applied to production. `POST /api/catalog/sync
{"seasonCode":"SS27","dryRun":true}` then reconciled exactly:

| | before | after |
|---|---|---|
| skipped | 1 | **0** |
| colorwayUpdates | 570 | 571 |
| priceRows | 6664 | 6678 (+14 = 7 lists × msrp/ws) |
| entryCreates | — | 1 (Fade Bone's SS27 entry) |
| variantCreates | — | 6 (the missing sizes) |
| renames / parks | — | empty — nothing moves SKU |

### Two things to watch after the real sync

**Loom re-nesting.** Fade Bone's row is already published to Loom (pushed
2026-09-13 as `LIV-BAR-FAD-BON`). The sync re-parents it from `LIV-STY-BARNES`
to `LIV-M-BRNS`, and Loom groups by `styleId` alone, so the next Loom push moves
it to a different style block. `LIV-STY-BARNES` keeps 8 of its 9 colorways, so
no empty shell is stranded.

While the Porcelain residue above is left in place, **two Loom products carry the
same SS27 price set** — Fade Bone's own (correct) and Faded Porcelain's
(inherited from the crossed sync, pushed 2026-09-15). That is now a Loom data
problem as well as an Origio one.

**`source` stays `CIN7_IMPORT`.** `buildColorway`'s update branch never writes
`source`, so the row is TF-bound and TF-synced but still labelled Cin7. Impact is
small — Loom's payload does not gate on source, and the one
`source === "CIN7_IMPORT"` check in `sync.ts` only picks suggestion wording. It
does mean `enrich-cin7.ts` (`where: { source: "CIN7_IMPORT" }`) still treats the
row as a Cin7 enrichment candidate.
