# The full Archive push — 2026-09-13/14

**3,781 colorways requested · 3,780 in Loom's registry · 1 rejected.**

Everything merchandise, every season, fully barcoded, into Loom's `archv` season
as identity-only registry records.

| | |
|---|---:|
| Created | 3,186 |
| Updated | 136 |
| Skipped | 0 |
| Rejected | **1** |

Origio marks 3,781 published; the one rejection still carries its 3 September
timestamp rather than tonight's, so the records are honest about what happened.

---

## Held back deliberately

| | Colorways | Why |
|---|---:|---|
| SS27 pre-season | 220 | No barcodes — not made yet |
| Seasonless Threadflow rows | 288 | No barcodes |
| Partially barcoded | 70 | A size that cannot scan is the ambiguity a registry exists to remove |
| Unresolved Threadflow/Cin7 twins | 11 | Loom keys on our colorway id; publishing the half we intend to retire would strand it |
| `EXT-BKST-BST-HR`, `EXT-PF-4`, `LIV` | 3 | Eligible on paper but holding another garment's barcode |

**No SS27 product reached Loom.** 20 colorways in the set carry an SS27 entry
alongside FW26 or Continuity, but the registry payload has no season field per
product at all — only the top-level `season: archv` — so nothing in the delivery
says SS27.

---

## The one rejection

```
LIV-KR-JPN-BLCK: product SKU LIV-KR-JPN-BLCK is owned by stable colorway
bd928077-59ae-49df-8a17-3d42b0609b98; merge or correct that identity before renaming
```

`bd928077-…` is **not an Origio colorway id.** It is
`Colorway.threadflowId` for `d9f57551-…`, which is the row we sent.

So Loom keys that product on the **Threadflow id**, while every push we make sends
`cw.id` — both `buildColorway` and `buildRegistryColorway` use it, and nothing in
`src/lib/loom/` ever sends a colorway's `threadflowId`. Loom learned that id from
somewhere other than this codebase.

**This is a question for Loom, not a defect to fix blind:** which id does the
registry treat as the stable colorway key, and why does it hold our Threadflow id
for this product and (apparently) our Origio id for the other 3,780? Guessing and
renaming would risk splitting a product that currently reconciles.

Worth noting the row has a merge tombstone beside it —
`LIV-KR-JPN-BLCK--merged-into-d9f57551` — so this colorway has been merged before.
That is the likeliest origin of the split identity.

---

## Two failures worth keeping

### The error body was thrown away

Batch 7 logged `HTTP Error 502: Bad Gateway` and nothing else, which reads like a
network problem. It was not. Our route answers **502 whenever Loom's job comes back
`ok: false`**, and the body carried Loom's per-item error naming the exact product
in one line. The script caught `HTTPError` and never called `e.read()`.

### A retry deduped into the original failure

Re-sending batch 7 unchanged returned `{"ok":true,"deduped":true}` with the
**same job id and its original error**. The delivery id is derived from the
contents, so an identical resend is treated as a repeat rather than a retry —
which `deliveryId()` documents, and which I walked into anyway. Passing an explicit
`eventId` is what makes a re-attempt actually run.

Both are now encoded in `scripts/loom/push-batches.py`.

---

## Still unanswered

**Does Loom store `shopify_inventory_item_id`?** 355 colorways that were already in
Loom were re-sent tonight carrying inventory-item ids for the first time, and Loom
reported `updated: 0` for every one. Either it ignores the field names, or it does
not count a metadata-only change as an update. That matters before anyone relies
on the inventory join, and only Loom can say which.
