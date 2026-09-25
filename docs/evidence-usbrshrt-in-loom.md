# Evidence: EXT-VN-NW-USBRSHRT is in Loom

Pulled live from Loom's own read API on 2026-09-17, token `origio_live_Rfnasf`.
Everything below is their response, not our records.

## Why the search finds nothing

Loom's own identity endpoint answers both namespaces for the string
`EXT-VN-NW-USBRSHRT`:

```json
{
  "key": "EXT-VN-NW-USBRSHRT",
  "kind": "sku",
  "colorway": null,
  "variant": {
    "id": "cmu2e47jw00x6s60k49polnip",
    "stableId": "57a29f1a-5160-4e42-b149-48c67e6e8a3e",
    "sku": "EXT-VN-NW-USBRSHRT",
    "name": "USBRSHRT",
    "barcode": "7000000011085",
    "colorway": {
      "id": "cmu2e47hj00w7s60kmpikq1fn",
      "stableId": "cfa4c1a2-8df6-4aab-b367-e8dd1102728f",
      "sku": "EXT-VN-NW",
      "name": "RUGBY SHIRT"
    }
  }
}
```

**`"colorway": null`.** There is no PRODUCT in Loom with that SKU — so a product
search for it correctly returns nothing. The string is held as a **variant**
(a size) of a product called **RUGBY SHIRT**, SKU `EXT-VN-NW`.

To find it in the Loom UI, search for **RUGBY SHIRT** (or `EXT-VN-NW`) and look
at its size list. "USBRSHRT" is one of 26 sizes.

The barcode resolves to exactly the same variant, which rules out a SKU-spelling
problem:

```json
{
  "key": "7000000011085",
  "kind": "barcode",
  "colorway": null,
  "variant": {
    "id": "cmu2e47jw00x6s60k49polnip",
    "stableId": "57a29f1a-5160-4e42-b149-48c67e6e8a3e",
    "sku": "EXT-VN-NW-USBRSHRT",
    "name": "USBRSHRT",
    "barcode": "7000000011085",
    "colorway": {
      "id": "cmu2e47hj00w7s60kmpikq1fn",
      "stableId": "cfa4c1a2-8df6-4aab-b367-e8dd1102728f",
      "sku": "EXT-VN-NW",
      "name": "RUGBY SHIRT"
    }
  }
}
```

## The full variant record Loom holds

`GET /api/origio/v1/variants/57a29f1a-5160-4e42-b149-48c67e6e8a3e`

```json
{
  "variant_id": "57a29f1a-5160-4e42-b149-48c67e6e8a3e",
  "loom_variant_id": "cmu2e47jw00x6s60k49polnip",
  "variant_sku": "EXT-VN-NW-USBRSHRT",
  "size_label": "USBRSHRT",
  "barcode": "7000000011085",
  "sitoo_sku": "EXT-VN-NW-USBRSHRT",
  "sitoo_sku_source": "barcode",
  "shopify_inventory_item_id": null,
  "shopify_link_source": null,
  "average_cost": 0,
  "stock": [
    {
      "location": "Livid Sentrallager",
      "source": "pio",
      "available": 0,
      "on_hand": 0,
      "reserved": 0
    }
  ]
}
```

Note `sitoo_sku` is populated and `sitoo_sku_source` is `barcode` — **Loom has
already matched this to Sitoo.** It is not unmatched.

## Its parent product

| | |
|---|---|
| product | `EXT-VN-NW` — "RUGBY SHIRT" |
| Loom product id | `cmu2e47hj00w7s60kmpikq1fn` |
| style | `EXT-VN-NW` — "RUGBY SHIRT" |
| season | Archive |
| channels | {'loom': True} · archived: False |
| Pio ref | `345259` (synced 2026-09-15T08:10:26.654Z) |
| variants | 26, **all 26 Sitoo-linked**, 1955 units on hand |

## Why it is still on the "missing" list

Loom already answered this, in their 2026-09-17 audit, §3:

> rows Loom HOLDS that are still queued as unmatched: 181
> (those are stale queue rows, not missing products — nothing clears a repair
> row when the variant later appears under the same SKU.)

`EXT-VN-NW-USBRSHRT` is line 163 of that same audit, reported as
`feed_id feed_id origio - EXT-VN-NW-USBRSHRT(barcode) pending` — Loom found it
by our stable id, stored the Sitoo SKU, and left the repair row `pending`.

So: **present, linked, stock-capable, and still listed as unmatched.**

## Reproduce it

```bash
curl -H "Authorization: Bearer $LOOM_TOKEN" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"skus":["EXT-VN-NW-USBRSHRT"]}' \
  https://loom.livid.no/api/origio/v1/identity

curl -H "Authorization: Bearer $LOOM_TOKEN" \
  https://loom.livid.no/api/origio/v1/variants/57a29f1a-5160-4e42-b149-48c67e6e8a3e
```

## What to ask Loom

1. Confirm variant `cmu2e47jw00x6s60k49polnip` (stable `57a29f1a-…`) is live in
   your catalogue and will carry stock for Sitoo SKU `EXT-VN-NW-USBRSHRT`.
2. **Clear the stale repair rows**, or tell us the rule — `sitoo_sku_repair_enabled`
   is on now, but a row already linked still reports `pending`, so the unmatched
   export overstates the gap by at least 181 rows and we cannot use it to
   measure progress.
3. Does your product search cover variant SKUs? Searching a size code returns
   nothing today, which is defensible — but it is how this looked like a missing
   product for a week.

## The real caveat

Nothing here is broken for stock. What IS wrong is the naming: 26 unrelated
vintage garments sit as "sizes" of one product called RUGBY SHIRT, because our
importer read the last SKU segment as a size. 473 vintage products lost their
name that way. That is a cosmetic/structural defect, fixable later, and it does
NOT block stock sync — which is why it should not be confused with the genuinely
missing products.
