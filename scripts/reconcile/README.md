# Cross-platform reconciliation

Snapshot every system's product data, then diff it. Read-only throughout —
nothing here writes to Origio, Sitoo, Shopify or Cin7.

```bash
python3 scripts/reconcile/fetch.py                  # -> snapshots/<today>/
python3 scripts/reconcile/reconcile.py snapshots/<today>
```

`fetch.py` reads credentials from `.env.local`. `snapshots/` is gitignored: it is
business data and it is large (~40 MB per run).

## Why snapshots rather than a live diff

The fetches are slow and rate-limited — a full run is roughly 10 minutes, most of
it Cin7. During clean-up you want to re-run the *diff* many times without
re-fetching, and a dated snapshot is evidence: you can show what was true when a
decision was made.

## Two traps this code exists to avoid

**Identity.** Records are linked by shared barcode **or** shared SKU, resolved
with union-find. Keying on barcode alone splits a product whose master row has no
barcode — and the master is only ~58% covered — so a product that is present gets
reported as missing. That mistake inflated an early run by roughly 600 products.

**Scope.** Two kinds of row are not merchandise and must not be reconciled as if
they were:

- **Cin7 holds production inputs** — buttons, samples, fabric. One SKU carries
  95,000+ units. Summing them makes every stock figure meaningless. Excluded via
  `NON_MERCH` categories.
- **Pre-season styles have no stock because they have not been made yet.** Gating
  on stock without checking the season proposes retiring the entire coming
  season. Excluded via `PRESEASON`; update it as seasons move into production.

## Findings emitted

| Finding | Meaning |
|---|---|
| `MISSING_FROM_ORIGIO` | Stocked somewhere, absent from the master |
| `MISSING_FROM_SITOO` / `_SHOPIFY` | In the master with stock, absent from that channel |
| `RETIRE_CANDIDATE` | In the master, no stock anywhere, not pre-season |
| `NO_BARCODE` | In the master, no barcode on any system, not pre-season |
| `SKU_CONFLICT` | One barcode, systems disagree on the SKU |
| `BARCODE_CONFLICT` | One SKU, systems disagree on the barcode |

Stock is **never summed across Sitoo and Cin7** — they describe the same physical
goods. Both are reported, separately.

## Platform notes

- **Sitoo** — `/v2/accounts/{account}/sites/{siteid}/products`, site id `1`: the
  *numeric* id, not the GUID `/sites` returns. Page size up to 1000. Stock lives
  per warehouse under `/warehouses/{id}/warehouseitems`; there are 17 warehouses.
- **Shopify** — Admin GraphQL `2025-10`, 100 products per page, 100 variants each.
- **Cin7** — `/product` and `/ref/productavailability`, `Limit=1000`, throttles
  hard; back off on 429.
- **Origio** — read with `psql` over `ORIGO_POSTGRES_URL_NON_POOLING`.
