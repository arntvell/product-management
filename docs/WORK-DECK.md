# Origio work deck — open items

**As of 2026-09-15.** Everything is on branch `product-master-cutover` (84 commits
ahead of `origin/main`, not merged — merging deploys production).

State of the master:

| | |
|---|---:|
| Colorways / variants (live) | 4,584 / 14,599 |
| Barcoded | 10,494 · **0 duplicates, enforced by a unique index** |
| In Loom's registry (`archv`) | 3,974 colorways |
| Origio vs Shopify SKU divergence | **0** |
| Origio vs Sitoo SKU divergence | 2 |
| Merge tombstones | 21 |

---

## A. Blocked on other people

Nothing here can be fixed from Origio. Each needs a request to the system's owner.

### A1 — Loom: un-archive or re-key 11 records · **blocks stock reconciliation**

The twin merges archived 11 Cin7 records in Loom. The surviving rows now hold the
correct SKUs again, but Loom refuses to let them claim those SKUs:

```
LIV-SRN-JPN-BLCK-DSK-2432 is owned by stable variant 7e058816-…
```

Loom binds a SKU to a variant id and will not release it to another. **Ask Loom to
un-archive the 11, or re-key them to the surviving variant ids.** Affects the
Siren, Intl, Abby, Cotton, Ida, Milo, Nara and V families — 330 units of central
stock sit against these SKUs.

### A2 — Loom: does it store `shopify_inventory_item_id`?

355 colorways were re-sent carrying inventory-item ids for the first time and Loom
reported `updated: 0` for every one. Either the field name is not accepted, or it
is stored but not counted as a change. **Matters before anyone relies on the
inventory join.**

### A3 — Loom: stop falling back to archived Shopify records

**3,119 variants** have no live Shopify presence — their SKU survives only on an
archived Shopify product. We send `shopify_inventory_item_id: null`, which is the
accurate statement; Loom resolves by SKU anyway and binds them to retired
listings. Confirmed on Keri, whose binding only corrected once the *live* Shopify
SKU was realigned. Realigning more SKUs cannot fix the rest — those products are
not on Shopify any more.

### A4 — Loom: the `LIV-KR-JPN-BLCK` stable-id conflict

Loom says that SKU is owned by `bd928077-…`, which is not an Origio colorway id —
it is that row's **`threadflowId`**. Nothing in `src/lib/loom/` has ever sent a
colorway's Threadflow id. Loom appears to read Threadflow directly, which would
also explain A1 and the Barnes name below.

### A5 — Threadflow: 12 wrong SKUs · **otherwise the next sync reverts our fixes**

Verified: an SS27 dry run plans `LIV-SRN-JPN-BLCK-DSK -> LIV-W-SRN-JPN-BLCK-DSK`
today.

| Threadflow should say | Currently says |
|---|---|
| `LIV-SRN-JPN-BLCK-DSK` | `LIV-W-SRN-JPN-BLCK-DSK` |
| `LIV-INTL-CLST-OX`, `-CLST-PNSTRP-OX`, `-GRY-OX`, `-WHT-OX` | `LIV-M-NTL-*` |
| `LIV-ABY-WH`, `LIV-COT-WHT`, `LIV-ID-BLCK`, `LIV-ML-WHT`, `LIV-NAR-WHT`, `LIV-V-WHT` | `LIV-W-*` |
| **Barnes**: `8465e34a` is Faded Porcelain (`LIV-BRNS-FDD-PRCLN`) | "Fade Bone" / `LIV-BAR-FAD-BON` |

The Barnes one also blocks every SS27 sync for that style — harmlessly; the other
570 colorways still apply. `docs/barnes-porcelain-clash.md`.

### A6 — Sitoo support: audit log on product ids 473–485

13 products disappeared during the push on 12 September and the cause is still
unknown. 100+ writes have landed clean since, so this is no longer blocking — but
it is unexplained, and that is the only reason the whole-account check runs after
every Sitoo write.

---

## B. Decisions needed from you

| # | Decision | Recommendation |
|---|---|---|
| B1 | **Give Pio the barcode as its join key** | The durable fix. Barcode survived every rename in this cutover; SKU did not. Until then every merge risks stranding central stock. |
| B2 | **FW26 launch date** | Asked three times and still unknown. It decides whether §C1 jumps the queue. |
| B3 | **The 38 shop-floor SKUs absent from Sitoo** | They hold stock nobody can ring up. ~~Needs a Sitoo create path, which does not exist.~~ **A create path now exists** — `src/lib/sitoo/create/`, proven against the sandbox. Worklist mode (export, create in the UI, run the linker) unblocks these today; the API path is gated behind `SITOO_CREATE_MODE=api`. |
| B4 | **3 barcode-identity disputes** | Two systems disagree about what a barcode identifies. Not renames — someone must say which garment owns the code. |
| B5 | **`VPACK25-*` (40) and `B2B-EPL-*` (23)** | Classified MERCHANDISE, absent from both channels. Probably a `CHANNEL_POLICY` case like imperfects and vintage. |
| B6 | **422 `VN-ONLN-*` never listed on Shopify** | ~308 units of unlisted sellable vintage. Publish, not retire. |
| B7 | **Cin7's 13,724 vintage records** | Time-bound: once Cin7 is off, that archive is gone. |
| B8 | **26 pre-existing archived Shopify SKU duplicates** | `LIV-KR-JPN-BRKN_` (11), and three others. Same defect as the 54 already suffixed. |
| B9 | **Where Pio fits** | It was the authority behind 9,822 barcodes and has a module in `src/lib/master/`, but was never named as a channel. Fourth channel, or retires with Cin7? |

---

## C. Work I can do, in priority order

### C1 — FW26 launch readiness

| | |
|---|---:|
| Colorways / variants | 231 / 1,897 |
| Without a barcode | **120** |
| Not in Shopify at all | **103 of 231** |

The 120 are not a sync fault — Threadflow's FW26 feed carries 860 variants, all
barcoded, and all are applied. 100 of the blanks are sizes Threadflow does not
have; 20 are dropped/unapproved and unbarcoded there too.

**The Shopify push has never been verified since the linker wrote 2,293
publications.** Three checks, all with a dry run: does it *update* via those
publications or *create*; media idempotency (flagged in memory, never tested
live); readiness gate and season-scoped price on FW26 specifically.

### C2 — Pio-stock guard on the merge preview · **do before any more merges**

The check that would have prevented 15 September: refuse, or loudly warn, when the
loser's SKU carries stock in Pio and the survivor's does not. **~70 merges are
queued behind it** (3 high-confidence, 55 medium, 58 candidates scanned).

### C3 — Merge tombstones keep Loom's handle

`merge-colorways.ts` drops the loser's LOOM publication, which loses the ability
to withdraw the record Loom still holds. I had to reconstruct the 11 ids by hand.

### C4 — Case-only divergence check after every merge

A merge can silently introduce one: `normalizeSku` uppercases before comparing, so
`LIV-Needle-W-L` and `LIV-NEEDLE-W-L` look identical to us and differ to Pio and
the shop stocktake. Caught once, fixed by hand; nothing reports it.

### C5 — The 53-and-shrinking barcode gap

Blank barcodes on live merchandise, by season:

| | Variants | |
|---|---:|---|
| `(none)` — seasonless Threadflow rows | 2,189 | Dropped or cancelled seasons |
| SS27 | 1,639 | Pre-season, correct |
| FW26 + FW26/SS27 | 114 | See C1 |
| Continuity | 48 | **The real gap** |

Only 5 of the Continuity ones have stock and need allocating — 3 Livid, 2 vintage
one-of-ones. Allocation is a one-way door (`recordIssued`), so it waits on B4's
external/vintage rule.

### C6 — The builders · **BUILT, on branch `product-builder`**

> **Done 2026-09-16.** The external-brand builder and its shared spine are
> implemented and verified. What follows is the original scope; see
> `docs/product-builder.md` for what each item became.
>
> | Was | Now |
> |---|---|
> | SKU convention enforced in the create form | `buildStyleSku`/`buildColorwaySku`/`buildVariantSku`; generated, read-only by default, hand-edits flagged. `Brand.skuToken` seeded from what each brand actually writes — **40 of 51 external brands would have been renamed by the rule alone** |
> | Barcode allocation wired to the UI | Blank by default, paste or CSV round-trip, explicit allocate. The CSV is sorted by size POSITION, not alphabetically |
> | Colour, fibre, manufacturer, customs fillable | Brand settings page over `BrandTemplate`, inherited by every new product |
> | Bulk paste, fill a column, apply across rows | Paste a colourway list, fill-down prices, "use the first colourway's sizes for all" |
>
> Plus three things that were not on the list and turned out to matter:
> **size systems** (ordered runs, archived-not-deleted, 2-D sizes spelled as the
> four digits both importers parse), **categories as a model** (93 created, all
> 3,966 styles and 4,607 colorways pointed at one, archivable), and **brand
> identity across channels**.
>
> Still open from this section: the **Livid builder** (5.2) and the **vintage
> builder** (5.4), which remains gated on access control.

The only item that stops any of this recurring.

- **Shared spine** — SKU convention enforced *in the create form* (`create.ts:145`
  is still `req(p.colorwaySku)`); barcode allocation wired to the UI (allocator and
  ledger exist, nothing calls them); colour, fibre, manufacturer, images (empty on
  1,175 imported colorways); customs fields (HS code, description, weight are empty
  in the Threadflow feed); bulk paste
- **Livid builder** — imperfects, repairs, sale buckets, collabs; the rows that land
  on the improvised `7000000*` range today
- **External builder** — barcode from the brand's own GS1 prefix, no Loom wholesale
  eligibility. Needs B4
- **Vintage builder** — **step 0 is access control.** One shared password is not
  roles. Store vintage → Sitoo, online vintage → Shopify, both created in Origio

### C7 — Automation

Scheduled Loom push (vintage and external first — `data` mode now admits them
where `full` never did); scheduled reconciliation; a reconciliation surface in
Origio; alerts on divergence.

### C8 — Cutting off origination

Everything above is undone if the other systems keep creating product. 689
Cin7-only variants need pushing out before Cin7 retires, then origination stops in
Sitoo, Shopify and Cin7.

---

## D. Before merging to `main`

| # | | |
|---|---|---|
| D1 | ~~**Auth middleware fails open**~~ **Fixed** | Production now hard-fails with a 503 when `APP_PASSWORD` is unset, instead of passing every request through. Development still passes through — a local checkout is not a deployment. |
| D2 | `SITOO_*` absent from Production | The Sitoo writer would be inert after a merge. Useful accident today; a to-do before C7. |
| D3 | `snapshots/` is gitignored | Every `FieldOwner.evidence` points inside it. The evidence for a decision should outlive one laptop. |
| D4 | 8 applied migrations | The database is already ahead of production. Additive, so old code is unaffected — the two converge on merge. |

---

## E. Done (for reference)

Backfill closed the 4,552 gap · barcode uniqueness enforced · ledger of 9,825
issued codes · provenance at variant level · Sitoo size runs fixed (a Small no
longer rings up a Medium) · Shopify SKU divergence 47 → 0 · 54 archived Shopify
SKUs suffixed · 11 Sitoo renames · NOV-GAT, repair line, Mink Suede and the
incense each moved to the row that owns the barcode · 3,974 colorways in Loom's
registry · 7,161 of the CFO's 7,520 held units recovered.

Detail: `docs/roadmap-2026-09-13.md`, `docs/status-2026-09-13.md`,
`docs/sku-alignment-2026-09-13.md`, `docs/stocktake-held-2026-09-15.md`,
`docs/twin-merge-reversal.md`, `docs/loom-archive-full-push.md`.
