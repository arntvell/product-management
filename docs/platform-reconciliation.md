# Standardising product data across platforms — scope

**Status:** scoping, nothing built.
**Goal:** get Origio to a defensible source of truth, then push it to Loom so stock
movements can be synced across channels while the Sitoo ↔ Shopify integration is
postponed.

Every number below was measured against the live master on 2026-09-11 with
read-only queries. They are the argument for the order of work.

---

## 1. The finding that sets the order

**Barcodes are the join key between a product master and a stock system, and the
current buying season barely has any.**

| Season | Variants | Missing barcode | |
|---|---:|---:|---|
| **SS27** | 4,839 | **4,083** | **84.4 %** |
| FW26 | 1,833 | 184 | 10.0 % |
| Continuity | 5,003 | 154 | 3.1 % |

By source: Threadflow variants are 4,083/5,255 missing (78 %); Cin7-imported are
150/4,903 (3 %). The historical catalogue — the part that came from the *old*
master — is in far better shape than the season currently being bought.

Nothing else in this document matters as much. You cannot reconcile stock across
Sitoo, Shopify and Cin7 on names or SKUs alone, because each system uses its own SKU
scheme (§3). The barcode is the one identifier they can all agree on, and SS27 does
not have it. **Fix barcode coverage first**; every other reconciliation gets cheaper
once it exists, and several become trivial.

Where do they come from? `Variant.barcode` is documented as "set once, never
blanked", and Threadflow is the source for current seasons. So the question to
answer before any code: **does Threadflow hold SS27 barcodes and we are not
ingesting them, or have they not been assigned yet?** Those need completely
different responses — a sync fix versus an operational process with your PLM.

---

## 2. Discrepancy classes already visible inside the master

These are wrong *before* any external system is consulted, which makes them the
cheapest thing to fix and a prerequisite for trusting a cross-platform diff.

| # | Class | Measured | Notes |
|---|---|---|---|
| 1 | Missing barcodes | 4,417 variants | §1 — the blocker |
| 2 | `IMP-` duplicate records | **42** colorways with a non-`IMP` twin | Same garment held twice; 11 more `IMP-` rows have no twin and may be legitimate |
| 3 | Duplicate barcodes | 2 barcodes across **24** variants | The same physical item under two product records — poison for stock sync |
| 4 | Duplicate brands | `P.F. Candle` / `P.F. Candles` | Two brand rows, one vendor |
| 5 | SKU scheme drift | not yet counted | ONBOARDING §4: Cin7 uses `JP` vs Shopify `JPN`, plus `IMP-` prefixes |
| 6 | Size-label drift | not yet counted | Threadflow sends `L32`, Cin7 sends `32`; legacy rows carry `W27/LL32`. `normalize-size-labels.ts` exists for this |

Classes 2 and 3 are the dangerous ones for stock: two records for one garment means
stock splits across them and neither balance is right.

Tooling that already exists and should be used rather than rebuilt:
`colorways/merge` (with dry-run and preview), `normalize/size-labels`,
`enrich/shopify`'s SKU → barcode → cleaned-name matcher, and `SyncRun`'s
errors/warnings/skipped split for reporting.

---

## 3. Identity keys, per system

Reconciliation is only as good as the key it joins on.

| System | Product key | Variant key | Notes |
|---|---|---|---|
| **Master** | `Colorway.colorwaySku` (unique) | `Variant.variantSku` (unique), `barcode` | `Style.styleSku` above it, also unique |
| **Shopify** | handle, product GID | variant SKU, barcode | `enrich-shopify` matches SKU → barcode → cleaned name, dropping ambiguous names |
| **Cin7** | `ProductCode` / family SKU | SKU, barcode | `splitSku` splits base + size; different scheme for old products |
| **Loom** | stable `style_id` / `colorway_id` | `variant_id`, `variant_sku`, `barcode` | Ids are ours; Loom stores what we send |
| **Sitoo** | — | — | **Unknown — see §5** |

The practical consequence: a three-way join must be **barcode-first, SKU-second,
name-never**. Name matching is what `enrich-shopify` falls back to, and it is
explicitly a last resort there for good reason — vintage and external products have
generic names that collide.

---

## 4. What to build

### 4.1 A snapshot table, not a live diff

Fetch each platform's product/variant inventory into a dated snapshot, then diff
snapshots. Reasons: the fetches are slow and rate-limited (Cin7 pages through
availability per SKU × location; the vintage image host 429s on ~25 rapid requests,
so assume others are no gentler), a diff you can re-run without re-fetching is
worth far more during clean-up, and a snapshot is evidence — you can show what was
true when a decision was made.

Shape: one row per `(platform, snapshot_id, product_key, variant_key, barcode, sku,
name, …)`. This is additive — new tables only, no change to the product model.

### 4.2 A discrepancy classifier

Over a pair of snapshots, emit typed findings rather than a raw diff:

- `MISSING_ON_PLATFORM` — in master, absent from Shopify/Cin7/Sitoo
- `ORPHAN_ON_PLATFORM` — on a platform, absent from master
- `SKU_MISMATCH` — same barcode, different SKU
- `BARCODE_MISMATCH` — same SKU, different barcode
- `VARIANT_COUNT_MISMATCH` — sizes differ
- `DUPLICATE_WITHIN_PLATFORM` — one barcode, several records (class 3 above)
- `NO_KEY` — no barcode on either side, so unreconcilable (this will be most of SS27)

Typed findings can be counted, filtered, assigned and burned down. A raw diff cannot.

### 4.3 A reconciliation surface in Origio

Rows = findings, grouped by class, with the platform values side by side and the
action to take. Reuse the patterns now on Collections — search, filters, sticky
header, selection, and **preview-before-write**, which matters more here than
anywhere else in the app.

### 4.4 Then, and only then, push to Loom for stock

Per the split you confirmed: Loom is a wholesale catalogue for Livid production
*and* a stock registry for everything. The registry push is a new mode that
bypasses eligibility and readiness (a stock row needs identity and SKUs, not customs
blocks) — see `docs/review-2026-09-10.md` §4a, and note `LoomMode` is already
`"full" | "data"`.

---

## 5. Open questions

1. **Sitoo — direct fetch, or trust Shopify?** `docs/product-master-architecture.md`
   §7.1 says *"Sitoo is downstream of Shopify (no direct integration needed here)"*.
   That was written for **pushing product data**, and it does not settle this case:
   Sitoo is the POS holding physical store stock, and a POS accumulates its own
   records over time. If Sitoo can hold a product Shopify does not, it needs its own
   snapshot and there is **no Sitoo client in this repo** — that is a build, not a
   query. If it genuinely mirrors Shopify, the reconciliation is three-way and
   cheaper. **This decides the size of the project.**
2. **Are SS27 barcodes missing in Threadflow, or missing in our ingest?** §1.
3. **When the master is wrong, what wins?** Cin7 was the master until recently, so
   for historical products Cin7 is often more correct than Origio — the `IMP-`
   duplicates are Cin7 import artefacts, but the underlying Cin7 records are what the
   business ran on. Arbitration cannot be a blanket "master wins".
4. **What does a Loom stock row actually need?** Identity + SKUs only, or prices and
   attributes too? Decides how much of the payload the registry mode carries.

---

## 6. Suggested order

1. Answer §5.1 (Sitoo) and §5.2 (barcodes) — both are questions, not code, and both
   change what gets built.
2. Fix the master's internal problems first: the 42 `IMP-` duplicates via
   `colorways/merge`, the 2 duplicate barcodes, the duplicate brand. Small, bounded,
   and they must not be exported to other platforms.
3. Barcode coverage for SS27 — whatever §5.2 turns out to require.
4. Snapshot fetchers, one platform at a time, starting with Shopify (the client
   exists).
5. Classifier + reconciliation surface.
6. Loom registry push mode.

Steps 2 and 3 are worth doing even if the rest is deferred: they are real data
defects in the system of record today.
