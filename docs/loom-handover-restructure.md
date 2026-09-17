# Handover to Loom — restructuring the vintage products, and read access for Origio

**From:** Origio · **Date:** 2026-09-17
**Companion:** `vintage-colorway-collapse.md` (our own diagnosis)

---

## 1. What we found

Your `sitoo-unmatched-skus.csv` led us to a defect on our side. Origio's Cin7
importer treats the **last hyphen segment of a SKU as the size**. For vintage that
segment is the *garment type*, so a whole family collapsed into one product:

```
what we sent you                        what it should have been
─────────────────────────────           ────────────────────────────────────
product  EXT-VN-NW "RUGBY SHIRT"        product EXT-VN-NW-USBRSHRT
  variant EXT-VN-NW-RGBY      (RGBY)      "US Heritage Brand Shirt"
  variant EXT-VN-NW-USBRSHRT  (USBRSHRT)  variant EXT-VN-NW-USBRSHRT (OS)
  variant EXT-VN-NW-BLZR      (BLZR)    …and 25 more products, one per garment
  …23 more
```

So `EXT-VN-NW-USBRSHRT` is in Loom — as a **size code** under a product called
RUGBY SHIRT. Searching Loom for "US Heritage Brand Shirt" finds nothing, because
that name exists nowhere in either system. **473 vintage products have lost their
name this way.**

Your audit was correct on every point. Nothing is missing; the shape is wrong.

### Scope

| | |
|---|---|
| Collapsed products (all brand Vintage) | **15** |
| Variants inside them that must become their own products | **488** |
| Of those, products whose name was lost | 473 |
| Styles involved | 15, **each holding exactly one colorway** |
| Names and prices recoverable from Cin7 | 488 of 488 |

Worst case is `VN-ONLN` — **391** distinct vintage garments sold online, all
sitting under one product called "Polo Ralph Lauren Shirt (S)".

Why only these: your newer vintage SKUs carry an explicit `-OS`
(`VN-ONLN-10000-OS`) and split correctly; the older ones do not
(`VN-ONLN-4399`), and the numeric tail was consumed as a size.

---

## 2. The operation we need, and why a push may not be enough

**The variant ids do not change.** That is the whole point — they are what your
stock, cost and order history hang off. What changes is the *parent*:

```
variant 57a29f1a-5160-4e42-b149-48c67e6e8a3e   (EXT-VN-NW-USBRSHRT)
  from colorway cfa4c1a2-8df6-4aab-b367-e8dd1102728f   "RUGBY SHIRT"
  to   colorway <new uuid>                             "US Heritage Brand Shirt"
```

488 of those moves, into 488 new colorways.

This is **not** the style re-nesting we did before. That was
`UPDATE Colorway SET styleId` — the colorway id never moved and your grouping
followed automatically. This time a **variant changes parent colorway**, and we
have no evidence about how your upsert handles that.

---

## 3. Orphan analysis — what we are trying to avoid

You asked us to avoid orphans; so do we. Level by level:

| Level | Risk | Our mitigation | Confirmed? |
|---|---|---|---|
| **Variant** | Loom creates a *new* variant instead of moving, leaving the old one under RUGBY SHIRT holding the stock history | Send the **existing `variant_id`** under the new colorway | ✗ depends on your upsert |
| **Colorway** | The 15 old colorways end up with zero variants and linger as empty products | Keep the row, send `channels.loom = false` to withdraw it | ✓ our payload emits a zero-variant colorway (no colorway-level filter), so the withdrawal transmits |
| **Style** | All 15 styles hold **exactly one colorway** — the broken one. If we moved everything out *and* removed that colorway, all 15 styles would empty, and `channels.loom` does not exist at style level, so we could never withdraw them | Keep the withdrawn colorway under its original style, so no style ever reaches zero colorways | ✓ by construction |
| **Stock** | Stock attached to the old colorway rather than the variant would strand on withdrawal | — | ✗ **we don't know where you hold stock** |
| **Channel links** | `sitoo_sku` / shopify ids established on the old variant | Variant id unchanged, so they should follow | ✗ needs confirming |

The style row is the one we cannot repair from our side if it goes wrong — this
is the same gap as in our 2026-09-16 split-styles note, still open.

---

## 4. Questions — the blocking ones first

**Q1 (blocking). Does your upsert re-parent a variant?**
For variant `57a29f1a-5160-4e42-b149-48c67e6e8a3e`, what happens if the next
`data` push places it under a new `colorway_id` instead of
`cfa4c1a2-8df6-4aab-b367-e8dd1102728f` — does it **move**, **duplicate**, or
**error**? And do stock, `sitoo_sku`, `shopify_inventory_item_id` and cost follow?

If you would rather we just try it: we will split `EXT-VN-NW` alone (26 items),
push with an explicit `event_id`, and read `GET /jobs/:id`. `variantsUpdated: 26`
tells us it moved, `variantsCreated: 26` tells us it duplicated. Say the word and
we will run exactly that one and stop.

**Q2 (blocking). Does the product-SKU ownership check span variant SKUs?**
The new colorway would carry `colorway_sku = EXT-VN-NW-USBRSHRT`, a string you
currently hold as a **variant** SKU. Your errors read
`product SKU X is owned by stable colorway <id>` — if that namespace includes
variant SKUs, every one of our 488 collides and we need a different SKU scheme
before we send anything.

For context, our vintage convention is `variant_sku == colorway_sku + "-OS"`
(1,843 of our 1,867 correct one-of-ones). These 391 `VN-ONLN` SKUs have no `-OS`
in Cin7 or Sitoo, and renaming the variant would break Sitoo's match key — so
`colorway_sku == variant_sku` is the only option left unless you advise otherwise.

**Q3. Is there an explicit move or merge operation?**
Or is "upsert with a new parent" the intended path for a restructure like this?

**Q4. What does `channels.loom = false` actually do** — archive or delete? Is it
reversible? Does the product keep its stock and history?

**Q5. Can a style be withdrawn at all?** Still open from 2026-09-16. If we ever do
need to empty one, is a style block with `channels: { loom: false }` and an empty
`colorways` array accepted?

**Q6. Two identity collisions we cannot resolve from here.** Both from your job log:
- `LIV-KR-JPN-BLCK` — "owned by stable colorway `bd928077-59ae-49df-8a17-3d42b0609b98`"
- `LIV-SRN-JPN-BLCK-DSK-2432` — "owned by stable variant `7e058816-5cef-4fca-a93f-406161e44744`"

We independently confirmed the first by barcode: Sitoo's `LIV-KRI-JP-BK` and our
`LIV-KR-JPN-BLCK` are the same garment under two SKUs. How do you want these
merged — is there an endpoint, or do you do it?

**Q7. 11 colorways archived in Loom but still holding stock in Pio.** Your
2026-09-15 `twin-merges` job reported 48 `kept_has_stock` item errors. Which side
should give way?

---

## 5. Read access for Origio — what we are asking you to build

Today we have exactly two endpoints: `POST /api/origio/v1/upsert` and
`GET /api/origio/v1/jobs/:id`. Our token `origio_live_Rfnasf` carries
`origio:write` only. **We cannot read a single thing back out of Loom**, which is
why this whole exchange has been a file swap.

We would like a read scope `origio:read` on the existing keys, and the endpoints
below. Ordered by how much back-and-forth each one removes.

### 5.1 `POST /api/origio/v1/upsert` with `validate: true` — highest value

Accept a normal payload, run every check, **apply nothing**, and return what
*would* happen per item:

```jsonc
{ "event_id": "...", "season": "archv", "mode": "data", "validate": true, "styles": [...] }
→ 200
{
  "valid": false,
  "items": [
    { "colorway_id": "…", "colorway_sku": "EXT-VN-NW-USBRSHRT",
      "action": "create",                       // create | update | move | archive | noop
      "variants": [ { "variant_id": "57a9…", "action": "move",
                      "from_colorway_id": "cfa4…", "to_colorway_id": "…" } ] },
    { "colorway_sku": "LIV-KR-JPN-BLCK", "action": "error",
      "code": "sku_owned_by_stable_colorway", "owner_id": "bd928077-…" }
  ]
}
```

This single endpoint answers Q1 and Q2 for any payload we care to try, and lets us
iterate without writing to your production or waiting on a reply. If you build only
one thing, build this.

### 5.2 `GET /api/origio/v1/identity?sku=…&barcode=…`

The ownership registry that produces your refusals:

```jsonc
{ "sku": "EXT-VN-NW-USBRSHRT",
  "owned_by": { "type": "variant", "id": "57a29f1a-…",
                "colorway_id": "cfa4c1a2-…", "colorway_sku": "EXT-VN-NW" } }
```

Lets us pre-flight every push and never send a colliding payload again. Should
accept a batch (`POST` with up to ~500 skus) — we have 3,853 to check.

### 5.3 `GET /api/origio/v1/products`

Paginated. Filters: `colorway_id[]`, `style_id`, `sku`, `barcode`, `season`,
`updated_since`, `archived`. Per row:

```jsonc
{ "colorway_id": "…", "colorway_sku": "…", "name": "…",
  "registry_only": true, "archived": false,
  "channels": { "loom": true, "shopify": false },
  "style": { "style_id": "…", "style_sku": "…", "style_name": "…" },
  "seasons": ["archv"], "prices": { "NOK": { "msrp": 499 } },
  "variants": [ { "variant_id": "…", "variant_sku": "…", "barcode": "…",
                  "sitoo_sku": "…", "sitoo_product_id": "…",
                  "shopify_inventory_item_id": "…", "on_hand": 1 } ] }
```

`on_hand` matters for the orphan question — we need to see what stock would be
stranded before we move anything.

### 5.4 `GET /api/origio/v1/products/{colorway_id}` and `/variants/{variant_id}`

Single lookup by our stable id, variant response including its parent chain.
`?by=sku` as an alternative key.

### 5.5 `GET /api/origio/v1/styles`

Style list with nested colorway ids — this is the only way we can see your
grouping. Please include **`?empty=true`** to list styles with zero colorways:
those are the shells we cannot withdraw, and we would like to stop creating them.

### 5.6 `GET /api/origio/v1/orphans` — the reconciliation you can do and we can't

Styles with no colorways · colorways with no variants · variants with stock whose
colorway is archived · variants with no Sitoo or Shopify link. Your 2026-09-15 job
already computes something close to the third.

### Practical notes

- JSON, `Authorization: Bearer`, same host and version prefix.
- Cursor pagination, up to 500 rows; we will be reading ~4,600 products.
- Please tell us the rate limit and we will stay under it.
- Confirm our ids are stable across any re-import on your side — the whole repair
  rests on `variant_id` surviving.

---

## 6. What we will do once you answer

1. Fix `splitSku` so a non-size trailing token is never eaten as a size. Our
   pending Cin7 backfill would otherwise reproduce this defect on 121 more SKUs.
2. Split the 15 collapsed colorways into 488, names and prices from Cin7,
   **variant ids unchanged**, 15 old colorways withdrawn.
3. Push in `data` mode, scoped to the 488 new + 15 withdrawn colorway ids, explicit
   `event_id`, then read `GET /jobs/:id`.
4. Send you the resulting id map — old colorway id → new colorway id per variant —
   so anything you hold that we cannot reach can be repointed on your side.

We have **not** run the Cin7 backfill and will not until `splitSku` is fixed and
Q1/Q2 are answered.

---

## 7. Two things from your audit worth recording

- **`updated: 0` is not a failure.** Your note that `updated` counts colorway rows
  only, and that identity writes land in `variantsUpdated`, resolves a
  long-standing wrong assumption on our side. We had it written into our schema
  that storage was unproven.
- **Your job timestamps appear to be CEST with a `Z` suffix.** The delivery you
  could not find — 2026-09-15 06:11:49 — is your job
  `cmu2e3rhz00jcs60kkjw6oilo`, logged at "08:08:22.775Z". Every push we have
  matches on colorway count at a ~1h57m offset (2h, less the job's own runtime,
  since we stamp after the job settles). Worth a look; it will cause confusion
  again otherwise.
