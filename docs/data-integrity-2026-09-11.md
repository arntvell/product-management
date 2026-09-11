# Making Origio hold the truth — integrity by construction

Written after a day of reconciling four systems. Grounded in the mistakes that day
produced rather than in general data-governance advice.

---

## 1. The diagnosis: every failure was a missing qualifier

Seven wrong conclusions were reached over the course of this work. Not one came
from bad data. Every one came from the master being unable to express a
distinction the business actually makes:

| Wrong conclusion | The missing distinction |
|---|---|
| ~600 present products reported missing | **Identity** — joined on barcode when the master is only 58 % covered |
| Shopify duplicates overstated 20× (41 vs 2) | **Lifecycle** — archived products counted as present |
| Proposed retiring 3,916 SS27 styles | **Lifecycle** — pre-season has no stock because it does not exist yet |
| Proposed merging 42 `IMP-` products | **Kind** — imperfects are a product, not a duplicate |
| Stock figures meaningless (95,598 "units") | **Kind** — Cin7 buttons and fabric are not merchandise |
| 21 phantom barcode conflicts | **Canonical form** — UPC-A and EAN-13 are one code |
| Would have overwritten Norda's real EAN | **Two facts in one slot** — store label ≠ manufacturer EAN |

**Anyone querying this master will make the same seven mistakes**, because the
distinctions live in a reconciliation script's constants rather than in the model.
That is the thing to fix, and it is a more useful definition of "integrity" than
field validation alone.

---

## 2. Three layers, and knowing which one a problem belongs to

The question "how do we get high integrity" collapses three different mechanisms.
Barcode is the worked example that touches all three.

### Layer 1 — the model can *express* it

Semantics currently carried in tribal knowledge and script constants:

| Needed | Today | Proposal |
|---|---|---|
| Merchandise vs material vs consumable vs aggregate | nothing | `Colorway.kind` enum |
| Live vs archived vs pre-season | `archived` + `status`, inconsistently used; nothing for pre-season | use `SeasonEntry.approvedForProduction` as the pre-season signal |
| Manufacturer EAN vs in-store scanning code | one `barcode` field | second field, e.g. `scanBarcode` |
| Channel eligibility | `isLoomEligible()` in code; `CHANNEL_POLICY` in a script | derive from `kind` + brand, in the model |
| How a row arrived vs what it is | `Source` conflates both | keep `Source` as provenance only; `kind` carries identity |

### Layer 2 — a constraint *enforces* it

These are mechanical and cheap:

- **Canonical form on write** — strip invisible characters, one rule for UPC-A vs
  EAN-13. This alone removes 21 phantom conflicts and would have rejected
  `07350141350230‬`.
- **Check-digit validation** — would have rejected `******************mangler`,
  the single-digit barcodes `1`–`7`, and the 14-digit `70903847293742`.
- **`@unique` on `Variant.barcode`** — **verified feasible today**: 6,009 variants
  carry a barcode, 5,987 distinct. The only collisions are 22 `STORAGE-*` rows
  sharing the placeholder `0`, and one repair pair on `7000000023361`. **24 rows
  to clear**, then the constraint holds and the class of error cannot recur.

### Layer 3 — a person *decides* it

No constraint can settle these, and pretending otherwise is how bad data gets
written confidently:

- Whether Norda's `990497*` (store label) or `872236*` (brand EAN) is "the"
  barcode — a modelling decision, answered by having both fields.
- Whether Barnes or Hayes owns the `7072536087*` block — **answered by scanning a
  garment**, not by any rule.
- Which of the 4,552 missing products belong in the master.

The discipline is to route each problem to the right layer, and to make layer 3
visible rather than silently guessed.

---

## 3. Provenance is what makes a cleanup defensible

This is the gap between a cleanup you *did* and one you can *defend*.

`FieldOwner` already records field-level ownership, but it has two limits that
bite here (`prisma/schema.prisma:316`):

- **`owner` is a `Source`** — `THREADFLOW | MANUAL | SHOPIFY_IMPORT | CIN7_IMPORT`.
  It cannot say *"the CFO list, 2026-09-11"* or *"Sitoo, as majority of two"*.
- **`entityType` is `"style" | "colorway"`** — there is no variant level, and
  barcode is a `Variant` field. So barcode **cannot have a `FieldOwner` at all
  today**, which is why the 122 corrections just applied left no trace in the
  database.

For those 122 barcodes, **"why does this say X?" is unanswerable from Origio.** The
answer exists only in a CSV and a commit message.

Proposed: admit `"variant"` as an `entityType`; `owner` becomes an authority
identifier that admits external sources, plus `evidence` (free text:
`cfo-list-2026-09-11`, `sitoo`) and `decidedAt`. Then:

- every corrected value carries why it was corrected,
- the next reconciliation can distinguish *"we decided this"* from *"it arrived
  this way"*, and
- a later disagreement can be adjudicated on recorded authority rather than
  re-litigated.

That is what "high integrity" means operationally: not just that the value is
right, but that you can show why.

---

## 4. The one-way door

**Reconciliation is a migration phase, not a steady state.** If Origio stays a
peer that gets *compared* with Sitoo, Shopify and Cin7, this exercise recurs every
quarter, because each system can still originate product data.

The end state is that Origio **assigns** identity — SKU and barcode — and the other
systems receive it. That is also the structural fix for "duplicate products with
different SKUs": `LIV-KRI-DWN` and `LIV-KR-JPN-DWN` exist because two systems could
both name the same garment. When only one can, there is no second spelling to
enter.

Sequence:

1. **Reconcile once** — close the 4,552 gap, settle conflicts, fix the two physical
   problems.
2. **Push** — Origio becomes the writer of SKU and barcode to each channel.
3. **Cut off origination** — the other systems stop creating product records.
   Until step 3, steps 1 and 2 have to be repeated.

Step 3 is organisational as much as technical, and it is the one that makes the
rest stick.

---

## 5. Cleaning up with confidence — the discipline that worked

Six practices earned their place today, each by catching something:

1. **Snapshot, then diff the snapshot.** Re-runnable without re-fetching, and it is
   evidence of what was true when a decision was made.
2. **Declare the authority before comparing.** "CFO list for Livid, Sitoo for
   external" is a rule that can be argued about; "Cin7 wins" was argued about and
   lost on evidence.
3. **Preview, always.** Every write in this session was previewed first. The
   carry-over dialog, `resolve.py`, the Loom dry run.
4. **Guards that refuse harm.** Two of them blocked 84 changes that would have
   created duplicate barcodes or pushed store labels into the master.
5. **Atomic sets where values interlock.** The shifted size runs collide row by row
   and resolve as a set. Row-at-a-time writing is not always safe.
6. **Escalate to physical verification** when the data cannot settle it. The
   Barnes/Hayes block needs someone to scan a garment.

Add one more, learned the hard way: **re-check the qualifier before trusting a
count.** Every headline number in this work moved once lifecycle, kind or canonical
form was applied — some by 20×.

---

## 6. Suggested order

| # | Work | Why first |
|---|---|---|
| 1 | Clear the 24 rows, add `@unique` + format validation on `Variant.barcode` | Verified feasible; closes a whole error class permanently |
| 2 | Extend `FieldOwner`: variant level, authority + evidence | Makes everything after it defensible; today barcode cannot be attributed at all |
| 3 | Add `Colorway.kind` | Removes the `NON_MERCH` / `NON_PRODUCT` constants from scripts |
| 4 | Use `approvedForProduction` as the pre-season signal | Removes the `PRESEASON` constant that goes stale |
| 5 | Second barcode field for scanning vs manufacturer code | Unblocks the 37 withheld store-label rows |
| 6 | Close the 4,552 gap | The master cannot be the truth while half the catalogue is missing |
| 7 | Turn on one-way push, then cut off origination | The only thing that stops this recurring |

1–5 are small and mostly additive. 6 is the large one. 7 is the one that matters.
