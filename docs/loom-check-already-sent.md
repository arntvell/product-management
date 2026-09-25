# For Loom: 182 variants Origio has sent, that Sitoo still cannot match

**Date:** 2026-09-17 · **Companion file:** `loom-check-already-sent.csv` (224 rows)

## What this is

Loom gave us `sitoo-unmatched-skus.csv` — 3,853 SKUs that exist in Sitoo but
match nothing in Loom. Most of them are genuinely missing from Origio and we are
backfilling those separately.

**224 of them are not missing.** Origio holds them, and Origio's own records say
we pushed them to Loom. This document is about those, so the two sides can be
compared against the same list.

## What Origio's records say

All 224 variants sit under 145 colorways. Every one of those colorways has a
`ChannelPublication` row for channel `LOOM`:

| | |
|---|---|
| `published = true` | 187 of 224 rows |
| `lastPushStatus` | `ok` |
| `lastPushedAt` | 2026-09-15 (181 rows) and 2026-09-16 (1 row) |
| `externalId` (key Loom returned) | **null on all 224** |
| `loomIdentityPushedAt` | **null on all 224** |

Of the 224, **182 were included in the payload** and 42 were not — we omit a
variant with no barcode, because it cannot reconcile a scan. Those 42 are our
problem, not yours, and they are marked as such in the CSV.

So: **182 barcoded variants, sent, acknowledged `ok`, and not matchable from
Sitoo.** That is what we would like checked.

## The three things we cannot see from our side

Loom's client exposes `upsert` and `jobs/<id>` only — there is no product read
endpoint — so we cannot tell which of these is true.

**1. Did they store?** Our `ChannelPublication.lastPushStatus = ok` records that
the delivery was accepted, not that the rows landed. We have seen an upsert
answer `created: 0, updated: 0` before, and our schema already carries the note
that Loom answered `updated: 0` to all 355 identity rows sent so far. If these
182 hit the same path, "sent ok" and "absent" are entirely consistent.

**2. What key are you matching Sitoo on?** `loomIdentityPushedAt` is null for
all 224 — meaning **we have never transmitted `sitoo_product_id` for any of
them**, even though Origio holds a Sitoo id for 177 of the 182. If your matcher
wants that id, it has nothing to work with and must be falling back to SKU or
barcode string comparison.

**3. Is it a normalisation difference?** Your file carries a `normalised_sku`
column that is uppercased. Our variant SKUs are mixed case
(`GH-LARSON-MOC-PENNY-black-41`). If Loom normalises the Sitoo side but compares
against a non-normalised stored SKU, every mixed-case product fails to match
while looking present in both systems.

## What we would like

Look up any of the 182 in Loom **by `loom_variant_id` / `loom_colorway_id`** —
those columns are Origio's primary keys, which we pass to you verbatim as
`variant_id` and `colorway_id`, so they are the one identifier that cannot have
been re-derived differently on either side.

For a handful of them, please tell us:

1. Does Loom hold the colorway? Does it hold the variant under it?
2. If yes — what `variant_sku`, `barcode` and `sitoo_product_id` does Loom have
   stored for it?
3. If no — did the 2026-09-15 delivery reach you, and what did it do with these
   rows?

Good candidates to start with, all barcoded and all sent on 2026-09-15:

| colorway_sku | variant_sku | barcode | kind |
|---|---|---|---|
| `EXT-KEEN-JAS-BB` | `EXT-KEEN-JAS-BB-40.5` | 0195208040573 | MERCHANDISE |
| `EXT-NOV-GAT-BLK` | `EXT-NOV-GAT-BLK-40` | 8585052170199 | MERCHANDISE |
| `EXT-PF-4` | `EXT-PF-4-12.5` | 0811379030259 | MERCHANDISE |
| `EXT-PF-4-INCN` | `EXT-PF-4-INCN-OS` | 0855111006676 | MERCHANDISE |
| `EXT-VN-AQSCT` | `EXT-VN-AQSCT-OS` | 7000000024702 | AGGREGATE |
| `EXT-VN-BANDTEE` | `EXT-VN-BANDTEE-OS` | 7000000015366 | AGGREGATE |
| `EXT-VN-BCKHT` | `EXT-VN-BCKHT-OS` | 7000000075247 | AGGREGATE |
| `EXT-VN-BRBAQCT` | `EXT-VN-BRBAQCT-OS` | 7000000023095 | AGGREGATE |
| `LIV-MSCSMPL-WM` | `LIV-MSCSMPL-WM-TP` | 7000000009181 | SAMPLE |
| `LIV-SMPLS-F-BKS` | `LIV-SMPLS-F-BKS-OS` | 7000000023958 | SAMPLE |
| `LIV` | `LIV-PCKUP` | 7000000023378 | CONSUMABLE |
| `LIV-SVD` | `LIV-SVD-RB` | 7072536031684 | CONSUMABLE |
| `LIV-REPSS` | `LIV-REPSS-OS` | 7000000023361 | SERVICE |

## Two notes on the composition

- **136 of the 182 are `AGGREGATE`** — store-vintage and sale buckets, where one
  SKU rings up any garment of that kind because second-hand items are not
  barcoded individually. They are real, they sell weekly in the shops, and they
  carry barcodes. If Loom filters them out as non-merchandise somewhere, that
  would explain most of this bucket in one stroke, and it is worth checking
  first.
- The remaining 46 are 26 MERCHANDISE, 16 SAMPLE, 3 CONSUMABLE, 1 SERVICE.

## CSV columns

`sitoo_sku`, `origio_variant_sku`, `barcode`, `size`, `loom_variant_id`,
`loom_colorway_id`, `colorway_sku`, `colorway_name`, `loom_style_id`,
`style_sku`, `style_name`, `kind`, `in_continuity`, `sitoo_product_id`,
`shopify_inventory_item_id`, `loom_published`, `loom_external_id`,
`last_pushed_at`, `last_push_status`, `loom_identity_pushed_at`,
`origio_expectation`.

`origio_expectation` is the column to filter on: `SHOULD be in Loom` (182) vs
`explained - no barcode` (42).

## One caveat on our side

We cannot tell you which **mode** the 2026-09-15 push ran in. `PushBatch` does
not record it and no batch row exists for these — the only trace is
`ChannelPublication.lastPushedAt`. If it ran as `full` rather than `data`, the
readiness gate and the Livid-only eligibility rule would have dropped every
external and vintage product in this list, which would account for a large share
of the 182 without any fault on Loom's side. We are fixing that gap in our own
logging regardless.
