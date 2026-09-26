# Handover to Loom: buy price per season, and a starting-cost import

**From:** Origio (Livid) · **Date:** 2026-09-26
**Status:** Origio sends `buy_prices` once branch `loom-buy-price` is merged.
Until then no delivery carries it. After the merge, Loom drops the field until it is added. The
starting-cost file is exported and waiting for an import.

Two separate things, and they must not be mixed:

| | Buy price | Starting average cost |
|---|---|---|
| What it is | What Livid expects to pay the supplier for a colourway **this season** | The cost of stock **already on the shelf** when Loom takes over costing |
| Level | Colourway × season | Variant |
| Who owns it | Origio: entered in the product builder and sent on every push | Loom, after a one-off import from Cin7's moving average |
| Used for | Pre-filling a PO line | The opening value of the variant's weighted average cost |
| Moves the average cost? | **Never** | Yes: it *is* the opening average |
| Brands | External brands | Livid and Vintage |

External brands get no starting cost. Their average cost will come from real PO
receipts in Loom, as the PO flow is extended.

---

## 1. Buy price (`buy_prices`)

### 1.1 What Origio sends

A new key on each colourway in the push body, in `mode: "data"` deliveries. That is
the registry shape every external brand travels in, including the automatic push
when a product is created in the builder:

```json
{
  "season": "FW26",
  "mode": "data",
  "styles": [{
    "colorways": [{
      "colorway_id": "…",
      "colorway_sku": "EXT-PNT-CRMFR-DRK-CML",
      "brand": "Pantherella",
      "prices": { "NOK": { "msrp": 350 } },
      "buy_prices": { "NOK": 124 },
      "variants": [ … ]
    }]
  }]
}
```

- **Keys are ISO 4217 currency codes** (`NOK`, `EUR`, `USD`…), the currency the
  supplier is paid in. They are **not** price-list codes: `USD_DAP` never appears
  here, and a buy price must not be looked up in or written to a price list.
- Values are numbers, excluding VAT, per unit. They apply to every size of the colourway.
- It is **season-scoped** in the same way `prices` is: the value belongs to the
  `season` at the top of the delivery. A colourway re-bought next season can
  carry a different buy price, and the old season's value should stay.
- Sent for **external brands only** (`brand` ≠ Livid). Livid's own production
  keeps sending its cost in `prices[].cost`, as before.
- **Omitted** when Origio has no buy price for that colourway in that season. A
  missing key means *keep what you have*. It never means clear, which matches
  how `channels` is read.
- Origio holds 62 buy prices today (38 in `archv`, 24 in FW26), all NOK. None
  has been sent yet. Every new product created in the builder adds one.

### 1.2 What Loom needs to build

1. **Storage:** a buy price on the colourway × season record, next to
   `product_season_entries` (or wherever `prices` land per season). Suggested
   name `buy_price`. It holds an amount and a currency, and optionally a small map if
   more than one currency is ever needed. Nullable.
2. **Ingest:** read `colorways[].buy_prices` on `/upsert`. Upsert on key presence
   and leave the stored value when the key is absent. Count it in the job summary,
   e.g. `buyPricesCreated` and `buyPricesUpdated`. Put a currency or value you
   reject in `itemErrors`, **not** a silent drop. Without the counters Origio can't
   tell a stored buy price from a discarded one, which already happened with the
   DKK price list.
3. **Read API:** return it on `GET /products` per season, e.g.
   `seasons[].buy_prices: { "NOK": 124 }`, so Origio can check it landed.
4. **PO flow:** when a PO line is added for a variant, pre-fill the unit price
   with the colourway's buy price for the PO's season (fall back to the latest
   season that has one). Only if the PO currency matches, or with the currency
   shown. It is a default the buyer can overwrite, nothing more.
5. **Guard:** the buy price must never be written to `average_cost` or used as
   one. The **receipt** cost is what moves the average.

### 1.3 After it is live

Tell Origio when the field is live. Origio will then re-push the external
colourways with a buy price, using an explicit new `event_id`: our derived ids
would dedupe into the earlier jobs that dropped the field.

---

## 2. Starting average cost: one-off CSV import

### 2.1 The file

`loom-starting-cost.csv`: **7,391 variants** (5,084 Livid, 2,307 Vintage), all
with `average_cost = 0` in Loom when it was read (2026-09-26, about 10:00 UTC). 3,981
of them hold stock: 36,821 units, NOK 8.34 m at these costs.

Vintage rows are single second-hand garments or bulk lots. Treat them like any
other variant.

| Column | Meaning |
|---|---|
| `loom_variant_id` | **Match key.** Loom's own variant id, taken from `GET /products` |
| `variant_id` | Origio's stable variant id (cross-check; 21 rows are blank because Loom holds no Origio id for them) |
| `variant_sku` | Variant SKU as Loom holds it (cross-check) |
| `barcode` | As Loom holds it (cross-check) |
| `starting_average_cost` | Per unit, 2 decimals |
| `currency` | Always `NOK` |
| `source` | Always `cin7_average_cost` |
| `source_ref` | The Cin7 SKU the cost came from (identical to `variant_sku`, except where it matched on barcode) |
| `loom_on_hand_at_export` | Loom's on-hand total at export, for reference only |
| `exported_at` | When the file was written (Loom was read shortly before) |

The cost is Cin7 Core's moving average cost (`AverageCost` on `/product`), in NOK.
Matched on SKU (case-insensitive), falling back to barcode. No row where SKU and
barcode pointed at different Cin7 products (there were none). Rows where Cin7's
cost is 0 are left out.

### 2.2 What the import has to do

1. **Match on `loom_variant_id`.** If it is not found, report the row and skip it. Don't fall back
   to SKU.
2. **Skip anything that already has a cost.** Write only where `average_cost` is 0
   or null *at import time*. A receipt may land between export and import, and
   that cost wins. Report skipped rows.
3. **Set the opening average.** Set `average_cost` to `starting_average_cost` for
   the quantity currently on hand. Record it as an opening-balance cost
   transaction (source `cin7_average_cost`, the date, the file name), not a bare
   field write, so the next receipt's weighted average reads it as the opening
   value and the audit trail says where it came from.
4. **No stock movement.** This sets value only. Quantities must not change, and
   nothing may be sent to Pio, Sitoo or Shopify stock.
5. **Dry run first.** It returns counts: matched, would-write, skipped (has cost),
   skipped (not found), rejected (bad value). Then the real run returns the same counts.
6. **Idempotent.** A second run writes nothing, because every row now has a cost.

A generic version that would also serve later imports: `POST` a CSV with
`variant key, cost, currency, source`, plus `dry_run` and
`only_if_zero` flags (default true).

### 2.3 Not in the file, deliberately

- **External brands other than Vintage (2,619 matchable variants):** their average cost will come
  from PO receipts.
- **Livid variants Cin7 never knew (4,234):** no cost to migrate.
- **The 274 variants that already have a cost:** left untouched.

### 2.4 Known consequence for external stock

**External stock already on hand has an average cost of 0**, and it keeps
that value until a receipt arrives. A plain weighted average then blends the
receipt with zero-cost units and understates the result. For example, 10 units on
hand at 0 plus 10 received at 500 gives 250. Loom needs a rule for this case. The
simplest one: when `average_cost` is 0 and on-hand is above 0, the first receipt
sets the average to the receipt cost rather than blending.

---

## 3. Reproducing the export

`scripts/loom-starting-cost/` in Origio: `scan.mjs` pulls Loom `GET /products`
and Cin7 `/product` (read-only), `match.mjs` matches them, `export.mjs` writes the
CSV. The intermediate JSON is not kept in the repo, so run all three in order
(`scan` → `match` → `export`) in one directory. Re-run them right before the import if
more than a few days pass.
