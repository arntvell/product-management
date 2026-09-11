# Cutover plan — making Origio the master in practice

Follows from the decision recorded in `docs/data-integrity-2026-09-11.md` §4.
Ordered by dependency, not by size.

---

## The organising principle: guards before backfill

The 4,552-product backfill is the moment identity gets **frozen**. Those records
will be pushed outward to Sitoo, Shopify and Loom and will become the thing every
scan and every order joins on. Importing them through an unguarded door means
inheriting every malformed barcode, every aggregate bucket and every untraceable
value — permanently, and in the system that is supposed to be the truth.

So the small integrity work comes first. It is days, not weeks, and it is what
makes the large import safe.

---

## Phase 0 — Barcode allocation (smaller than first stated)

**Threadflow allocating barcodes for Livid production is not a problem.** Barcodes
are issued when production volumes are set, which is a Threadflow event. A master
of product does not have to mint every identifier — it has to guarantee the
identifier is unique and hold the record of what was issued.

Inspecting the CFO ledger settles how allocation actually works:

- The `Product Code` column **is a sequence number**. Every barcode is
  `prefix + zero-padded counter + EAN-13 check digit` — verified on **9,822 of
  9,822 rows, zero mismatches**.
- **Two ranges, two counters.** `7072536` for production, at high-water mark
  **12,257** (9,748 issued, 2,510 numbers unused inside the span). `7000000` for
  non-production — samples, sale buckets, `EXT-IMP-MISC` — at 2,444.
- So Origio-born product is **already served** by the existing process. The
  `7000000*` range is not improvised; it is a deliberate second series.
- 9,276 of the rows carry `Added = 2026-03-30`, a bulk export of the back
  catalogue. Only ~546 are genuine allocations since.

### What the actual risk is

Not "two systems allocate". It is **two counters on one range**. If Origio starts
issuing numbers without reading the same high-water mark that Threadflow and the
CFO process read, it will eventually reissue a number that is already on a
physical garment.

### What Origio therefore needs — and it is small

**Hold the ledger, not necessarily the pen.** Load the CFO list as the issued-number
record, and record every barcode Origio learns about. Two things follow:

1. The Phase 1.1 uniqueness constraint gains something real to enforce against —
   it can reject a collision instead of discovering it during reconciliation.
2. Allocation becomes `max(issued) + 1` on the relevant range, which is a few
   lines, so Origio *can* issue when it needs to without a spreadsheet round-trip.

Whether Threadflow keeps issuing for production, or eventually draws its numbers
from Origio, is then a later convenience rather than a blocker. The one rule that
matters is **one counter per range, and Origio knows its value.**

## Phase 1 — Close the door (small, additive)

**1.1 Barcode integrity on `Variant`**
- Clear the 24 blocking rows (22 `STORAGE-*` placeholders on `0`, one repair pair).
- Add `@unique`, canonical form on write (strip `Cf` characters, one rule for
  UPC-A/EAN-13), and check-digit validation.
- Verified feasible: 6,009 barcodes, 5,987 distinct.

This closes a whole class of defect permanently and is the prerequisite for
trusting any join afterwards.

**1.2 `Colorway.kind`** — merchandise / material / consumable / aggregate.
Retires the `NON_MERCH` and `NON_PRODUCT` constants from `reconcile.py` into the
model, and is what stops the backfill importing sale buckets and clothes hangers.

**1.3 `FieldOwner` at variant level, with authority and evidence.**
Add `"variant"` as an `entityType`; `owner` admits external authorities; add
`evidence` and `decidedAt`. Without this the backfill lands 4,552 products whose
values cannot be explained later.

All three are additive except the unique index, which needs its 24 rows cleared in
the same migration. Note these run against the production Neon database.

---

## Phase 2 — The last read

The backfill. Three things to get right:

**Resolve Cin7's 75 `EEXT-`/`EXT-` twins first**, or both halves import and the
master is born with the duplicates it was meant to eliminate.

**Re-snapshot at import time.** The stock gate is a moving target — importing in
October against a September snapshot will both miss new product and drag in
product that has since sold out. Better still, **gate on *sellable*, not
*stocked***; stock is a state, not an identity.

**Preview then apply**, in the pattern already proven by the carry-over dialog and
`resolve.py`. Every imported record gets its `kind` and its provenance stamped at
entry.

Then the two cleanups that only make sense once the master is complete: retire the
956, and fill the 270 missing barcodes.

---

## Phase 3 — Let Origio originate

Without these, "product is created in Origio" is not yet true in a way that
prevents the problems being cleaned up.

**3.1 SKU assignment at create.** `create.ts:145` takes a typed string. The master
should generate it, or at minimum validate it against the convention and reject a
near-duplicate of an existing SKU. `LIV-KRI-DWN` vs `LIV-KR-JPN-DWN` is preventable
only here.

**3.2 Barcode allocator**, per the Phase 0 decision, wired into `create.ts` so
Origio-born product is no longer born without an identifier.

---

## Phase 4 — Push outward

**4.1 Sitoo writer.** The missing third of "populated from Origio". Needs a
product-id mapping alongside `ChannelPublication`, seeded from the reconciliation
output — **the first push is a match-and-update, not a create**, or it duplicates
14,714 products.

Sitoo appears to enforce barcode uniqueness (zero internal duplicates), so the
shifted size runs will collide at the API exactly as they did in the resolver. The
writer needs two-phase or whole-product writes.

**4.2 The corrections ride this push.** Sitoo's 55 and Shopify's 232 are not script
runs; they are the first thing the master asserts.

**4.3 Then Loom as the stock registry** — which is the point of all of it, and
which is only safe once identity is atomic, because its sync joins Sitoo scans to
Shopify orders on exactly that.

---

## Phase 5 — Cut off origination

Sitoo, Shopify and Cin7 stop being able to create product records. Organisational
more than technical, and the only step that stops this recurring.

---

## Where I would start

**Phase 1.1, today.** It is verified, it is 24 rows, it closes a defect class
permanently, and everything after it is safer for having it. Phase 0 turned out to
need no decision from you — only the CFO list loaded as the issued-number ledger,
which Phase 1.1 wants anyway.
