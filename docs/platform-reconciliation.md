# Standardising product data across platforms — scope

**Status:** scoping, nothing built.
**Goal:** get Origio to a defensible source of truth, then push it to Loom so stock
movements can be synced across channels while the Sitoo ↔ Shopify integration is
postponed.

Every number below was measured against the live master on 2026-09-11 with
read-only queries. They are the argument for the order of work.

---

## 1. Barcode coverage — not a defect, a lifecycle stage

**Corrected 2026-09-11.** The first draft of this document led with SS27's missing
barcodes as the blocking defect. That was wrong, and the correction matters because
it removes the largest item from the critical path.

SS27 is **pre-season**. The products do not exist yet. Production volumes are set on
all styles first, and barcodes are created at that point. The 84% figure below is
what a season in pre-sale is *supposed* to look like — it is not a data quality
problem and there is nothing to fix.

| Season | Variants | Missing barcode | |
|---|---:|---:|---|
| **SS27** | 4,839 | **4,083** | **84.4 %** |
| FW26 | 1,833 | 184 | 10.0 % |
| Continuity | 5,003 | 154 | 3.1 % |

What still holds: **barcode is the join key**, because each platform uses its own SKU
scheme (§3), and it is the one identifier they can all agree on. What follows from
the correction:

- **Reconciliation is scoped to what physically exists** — FW26 (90% covered) and
  Continuity (97%). Those are the seasons with stock to sync, which is the entire
  point. SS27 has no stock to reconcile.
- **FW26's 184 and Continuity's 154 gaps are the real list**, and they are small
  enough to work through by hand.
- **Re-run this measurement after production volumes are set.** At that point SS27
  barcodes should appear; if they do not, *that* is a sync defect worth chasing.

---

## 2. Discrepancy classes already visible inside the master

These are wrong *before* any external system is consulted, which makes them the
cheapest thing to fix and a prerequisite for trusting a cross-platform diff.

| # | Class | Measured | Verdict |
|---|---|---|---|
| 1 | Missing barcodes, FW26 + Continuity | 338 variants | **Real**, and small enough to fix by hand |
| 2 | Duplicate brands | `P.F. Candle` / `P.F. Candles` | **Real** — confirmed, one is a bad record |
| 3 | SKU scheme drift | not yet counted | **Likely** — ONBOARDING §4: Cin7 `JP` vs Shopify `JPN` |
| 4 | Size-label drift | not yet counted | **Likely** — TF sends `L32`, Cin7 `32`, legacy `W27/LL32`; `normalize-size-labels.ts` exists |
| ~~5~~ | ~~`IMP-` duplicates~~ | ~~42~~ | **Not a defect — see below** |
| ~~6~~ | ~~Duplicate barcodes~~ | ~~2 / 24 variants~~ | **Not a defect — see below** |

### Two retracted findings

**`IMP-` records are not duplicates.** The first draft counted 42 `IMP-` colorways
with a non-`IMP` twin and proposed merging them via `colorways/merge`. **That would
have destroyed a real business distinction.** `IMP-` means *imperfect*: production
errors sold at a discount rather than thrown away. `IMP-LIV-BRNS-JPFD` and
`LIV-BRNS-JPFD` are deliberately two products — different condition, different
price, and they must stay separately tracked. 53 of them exist. The twin is the
point, not the bug.

*Lesson for the classifier (§4.2):* a shared name or a prefix relationship is not
evidence of duplication. Only a shared **barcode** is, and even then see below.

**The two "duplicate barcodes" are placeholder values on non-products.** 22 of the
24 variants carry barcode `0` and are all `STORAGE-*` records — packaging, hangtags,
shop lighting, cleaning supplies, tools, "Deadstock Rest". The other pair are repair
line-items. None is a garment; `0` is a placeholder, not a barcode.

### A class the first draft missed: non-product records

67 `STORAGE-*` colorways exist in the master — internal consumables and operational
line items that arrived with the Cin7 import, because Cin7 tracked them as stock.
None is published to any channel today.

They matter here precisely because the registry push is meant to send *everything*:

- They **should not** go to Shopify or Loom's wholesale catalogue — they are not
  merchandise.
- They **may well** belong in a stock registry, since they are things the business
  physically holds and counts.

That is a decision to make deliberately before the registry push, not something to
discover afterwards. Class breakdown of the live master: 1,610 vintage, 1,199
mainline, 464 `EXT-`, 67 `STORAGE-`, 53 `IMP-`.

Tooling that already exists and should be used rather than rebuilt:
`colorways/merge` (with dry-run and preview), `normalize/size-labels`,
`enrich/shopify`'s SKU → barcode → cleaned-name matcher, and `SyncRun`'s
errors/warnings/skipped split for reporting.

---

> **Superseded 2026-09-11 by `docs/reconciliation-findings-2026-09-11.md`.**
> §2a below was a two-way Sitoo↔master diff keyed barcode-first. That join splits
> a product whose master row has no barcode — and the master is only 58% covered —
> so it counted present products as missing. Its headline of **5,271** is wrong;
> the four-way union-find figure is **4,583**. The section is kept because its
> *reasoning* about why the hole exists still holds, and because the error is worth
> remembering: identity resolution has to come before counting.

## 2a. First real reconciliation: Sitoo vs the master (2026-09-11) — superseded

Sitoo API access is working (§5.1 resolved — the path is
`/v2/accounts/{account}/sites/{siteid}/products`, site id **1**, not the GUID from
`/sites`). A full read-only snapshot of all 14,714 rows was pulled and diffed
against the master's 10,265 variants.

### Coverage

| | Rows | With a usable barcode |
|---|---:|---:|
| Sitoo (all) | 14,714 | 14,667 — effectively 100 % |
| Sitoo, active | 9,083 | |
| Sitoo, active variant rows | 8,630 | |
| Master variants | 10,265 | 5,903 — 57 % |

**Sitoo's barcode hygiene is far better than the master's.** For reconciliation
purposes Sitoo is the more reliable side of the join, which inverts the assumption
that the master arbitrates.

### The headline number

**5,384 active Sitoo rows carry a barcode the master has never seen.** Broken down
by cause:

| Count | Cause | Action |
|---:|---|---|
| **5,271** | Not in the master by SKU either — **the product is genuinely absent** | Import, or decide it is out of scope |
| 63 | In the master, but the master has no barcode | Fill the barcode in — trivial |
| 50 | In the master **with a different barcode** | Real conflict; needs arbitration |

Of 2,084 `LIV`-prefixed rows in the gap, **1,980 do not exist in the master at all**.
This is Livid's own product, active and sellable in the POS, absent from the system
of record.

### Why the master is missing 5,271 active products

This is structural, not accidental, and it follows from how the master was built:

- **Threadflow** only holds current seasons — it is new software with no history.
- **The Cin7 import** was scoped to `OnHand > 0` at six locations, so anything out of
  stock on import day never came across.

Sitoo, by contrast, holds everything still active in the POS. So the master has a
systematic hole exactly where those two sources do not overlap: products that predate
Threadflow *and* happened to be out of stock when Cin7 was imported.

**This changes the project's shape.** Pushing "the true source of truth" to Loom for
stock sync cannot happen while the source of truth is missing 5,271 active sellable
items. Closing that gap is now the first substantive piece of work, ahead of the
classifier and the reconciliation UI.

### Cross-platform defects found

- `SKU_MISMATCH` — only **3**, but two are genuine data errors, not naming drift:
  - `8585052170441` — Sitoo `EXT-NOV-GAT-WHT-41` vs master `EXT-NOV-GAT-BLK-41`
    (**white vs black on one barcode**)
  - `4582746159205` — Sitoo `…SCKS-RYL-BL-M` vs master `…-S` (**size M vs S**)
  - `7000000023361` — the repair line item, known
- `DUPLICATE_WITHIN_SITOO` — **zero**. No barcode maps to two Sitoo product ids.
- The 50 same-SKU-different-barcode conflicts are concentrated in
  `LIV-BRNS-JPN-DWN-*`, which suggests one re-barcoded run rather than scattered
  entry errors.

---

## 3. Identity keys, per system

Reconciliation is only as good as the key it joins on.

| System | Product key | Variant key | Notes |
|---|---|---|---|
| **Master** | `Colorway.colorwaySku` (unique) | `Variant.variantSku` (unique), `barcode` | `Style.styleSku` above it, also unique |
| **Shopify** | handle, product GID | variant SKU, barcode | `enrich-shopify` matches SKU → barcode → cleaned name, dropping ambiguous names |
| **Cin7** | `ProductCode` / family SKU | SKU, barcode | `splitSku` splits base + size; different scheme for old products |
| **Loom** | stable `style_id` / `colorway_id` | `variant_id`, `variant_sku`, `barcode` | Ids are ours; Loom stores what we send |
| **Sitoo** | `productid`, `variantparentid` | `sku`, `barcode` (100 % coverage) | `/sites/1/products`; flat rows, variants point at a parent |

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
- `NO_KEY` — no barcode on either side, so unreconcilable
- `IMPERFECT_PAIR` — an `IMP-` record and its twin: **expected, never a duplicate**

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

1. ~~Sitoo API access~~ **Resolved 2026-09-11.** Path is
   `/v2/accounts/{account}/sites/{siteid}/products` with **site id `1`** — the numeric
   id, not the GUID returned by `/sites`. Page size up to 1,000. Full snapshot pulled;
   see §2a. This supersedes `docs/product-master-architecture.md` §7.1 ("Sitoo is
   downstream of Shopify, no direct integration needed") — true for pushing product
   data, false for reconciling stock.
2. ~~Are SS27 barcodes missing in Threadflow or in our ingest?~~ **Answered:** neither
   — SS27 is pre-season and the products do not exist yet (§1). Re-measure once
   production volumes are set.
3. **When the master is wrong, what wins?** Cin7 was the master until recently, so
   for historical products Cin7 is often more correct than Origio — the `IMP-`
   duplicates are Cin7 import artefacts, but the underlying Cin7 records are what the
   business ran on. Arbitration cannot be a blanket "master wins".
4. **What does a Loom stock row actually need?** Identity + SKUs only, or prices and
   attributes too? Decides how much of the payload the registry mode carries.

---

## 6. Suggested order

1. ~~Unblock Sitoo API access~~ — **done** (§2a).
2. **Merge the duplicate brand** (`P.F. Candle` / `P.F. Candles`) — small, confirmed,
   and it should not be exported anywhere.
3. **Decide what `STORAGE-*` records are** for the registry push (§2). 67 rows, and
   the answer changes what "push everything" means.
4. **Close the 5,271-product gap** (§2a) — decide which of those active Sitoo
   products belong in the master, and import them. This is now the biggest piece.
5. **Snapshot fetchers** as real code, one platform at a time: Sitoo (proven by the
   throwaway script used for §2a), Shopify (client exists), Cin7.
6. **Classifier + reconciliation surface.**
7. **Loom registry push mode**, then the Sitoo sandbox once corrections are scoped.

Steps 2 and 3 are worth doing regardless: one is a real defect, the other a decision
that will otherwise be made accidentally by whoever writes the registry push.
