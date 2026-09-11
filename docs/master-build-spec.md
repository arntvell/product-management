# Build spec — Origio as master

Concrete work items behind `docs/master-cutover-plan.md`. Per item: what is
touched, whether it needs a migration, and whether it is on the critical path to
**Loom live as the stock registry**.

---

## 0. One decision first: Loom has two jobs and one eligibility rule

You told me two things that are both true and that now collide in the code:

> "external products and vintage should never go to loom"
> "we are building a temporary function in Loom that allows us to sync stock
> movements across our sales channels"

The first is about **Loom the B2B wholesale catalogue**. The second is about
**Loom the stock registry**. The guard added earlier does not distinguish them:

```
src/lib/loom/push.ts:108   loomIneligibleReason({ brandIsLivid: cw.brand?.isLivid })
```

It runs unconditionally, before readiness, and **independently of `opts.mode`** —
which is only consulted at line 142, when the payload is built. So in `"data"`
mode, the registry mode, every external and vintage product is silently skipped.

That is 1,545 `EXT`, 390 `VN-ONLN` and 70 `CHIMI` in the missing-4,552 alone,
plus every external already in Origio — precisely the stock that most needs
registering, since externals are bought-in and their stock is the money.

**Proposal: make the guard mode-aware.**

| Mode | Carries | Payload |
|---|---|---|
| `full` — wholesale catalogue | Livid brand only, readiness-gated | full product, prices, media |
| `data` — stock registry | **every stocked variant**, no brand filter | identity only: sku, barcode, size, colourway ref |

The wholesale rule is preserved exactly — no external or vintage product appears
in the B2B catalogue. The registry sees everything that moves, which is what a
registry is for. **If you would rather the registry also exclude vintage, say so
and it becomes a one-line change** — but it would mean vintage stock stays
invisible to the sync.

Nothing else in this spec is blocked by this decision.

---

## 1. Critical path

Only these four get Loom live as the registry:

```
A. Barcode primitives + ledger + unique index
B. Backfill the 4,552 (widened Cin7 import)
D. Sitoo barcode writer (sandbox first)
E. Mode-aware Loom push, registry mode
```

Everything else — SKU assignment, `Colorway.kind`, the `FieldOwner` extension —
is needed before **cut-off** (Phase 5), not before **go-live**. Useful to build
early; not a reason to delay shipping.

---

## 2. Track A — barcode primitives

| # | Item | Touches | Migration |
|---|---|---|---|
| A1 | `canonical()`, `isValidEan13()`, `checkDigit()`, `allocate(range)` | **new** `src/lib/master/barcode.ts` | no |
| A2 | `BarcodeAllocation` ledger — `{ range, sequence, barcode, sku, issuedAt, authority }` | schema | **yes** (additive) |
| A3 | Load the CFO list into the ledger — 9,822 rows, high-water marks 12,257 / 2,444 | **new** `scripts/load-barcode-ledger.py` | no |
| A4 | Clear the 24 blocking rows, then `@unique` on `Variant.barcode` | schema | **yes — the only non-additive step** |
| A5 | Apply `canonical()` + check-digit validation on every write path | `threadflow/sync.ts`, `cin7/import.ts`, `master/edit.ts`, `create.ts` | no |

A1–A3 are independent and can land together. A4 needs A1 (canonical form first, or
the index rejects rows that are actually the same barcode written two ways).

---

## 3. Track B — the backfill

**Not a new module.** `src/lib/cin7/import.ts` already exists and is proven, and
Cin7 agrees with Origio on 5,903 of 5,903 shared barcodes. The work is to widen
its gate, not to rewrite it.

| # | Item | Touches | Migration |
|---|---|---|---|
| B1 | Re-snapshot all four systems — the stock gate goes stale | `scripts/reconcile/fetch.py` | no |
| B2 | Emit an import allowlist: stocked/sellable merchandise, `NON_PRODUCT` and `EEXT-` twins excluded | `scripts/reconcile/reconcile.py` | no |
| B3 | Widen the import gate from `OnHand > 0` to that allowlist | `cin7/import.ts` | no |
| B4 | Apply the `resolve.py` authority chain to barcodes **at import**, not after | `cin7/import.ts` + `barcode.ts` | no |
| B5 | Stamp `kind` and provenance on every imported row | `cin7/import.ts` | needs A2, C3 |
| B6 | Run existing `enrich/shopify` over the imported set | existing route | no |

Preview-then-apply throughout, as `carry-over` and `resolve.py` already do.

---

## 4. Track D — Sitoo writer (narrow)

**Not a third channel publisher.** Sitoo holds 14,714 products; Origio will hold
~10k after backfill. Nothing needs *creating* there for the registry — the writer
only corrects identity.

| # | Item | Touches | Migration |
|---|---|---|---|
| D1 | Site-scoped client — account `91622`, numeric site id `1`, **not** the GUID from `/sites` | **new** `src/lib/sitoo/client.ts`, `types.ts` | no |
| D2 | `VariantChannelRef { variantId, channel, externalId, lastPushedAt }` — `ChannelPublication` is colorway-level with one `externalId`; Sitoo is per-SKU and so is the registry | schema | **yes** (additive) |
| D3 | `Channel` enum `+= SITOO` | schema | **yes** (additive) |
| D4 | Seed `VariantChannelRef` from the reconciliation output — **match-and-update, never create** | **new** `src/lib/sitoo/link.ts` | no |
| D5 | `updateBarcode(externalId, barcode)`, applied against the **sandbox** first | **new** `src/lib/sitoo/push.ts` | no |
| D6 | Two-phase write for the rotated size runs (`LIV-CN-BCHK-*`, `LIV-HNR-BGST-*`) — Sitoo has zero internal duplicate barcodes, so it will reject row-at-a-time | `sitoo/push.ts` | no |

D5 is where the 55 Sitoo and 232 Shopify corrections get applied — as the master
asserting, not as a script patching.

---

## 5. Track E — Loom registry

| # | Item | Touches | Migration |
|---|---|---|---|
| E1 | Make the eligibility guard mode-aware (§0) | `loom/push.ts`, `master/readiness.ts` | no |
| E2 | Registry payload — identity only, no prices or media | `loom/payload.ts` | no |
| E3 | Push every stocked variant in registry mode; record in `VariantChannelRef` | `loom/push.ts` | needs D2 |

---

## 6. Off the critical path — needed before cut-off

| # | Item | Touches | Migration |
|---|---|---|---|
| C1 | Barcode allocation at create for Origio-born product | `create.ts` + `barcode.ts` | no |
| C2 | **Near-duplicate SKU rejection** at create | `create.ts` | no |
| C3 | `Colorway.kind` — merchandise / material / consumable / aggregate | schema | **yes** (additive) |
| C4 | `FieldOwner`: `"variant"` entityType, `authority`, `evidence`, `decidedAt` | schema | **yes** (additive) |
| C5 | `/catalog/reconcile` surface — reuse the Collections patterns | new page + route | no |

**C2 is the one that matters and it is easy to get wrong.** `Variant.variantSku` is
*already* `@unique` (`schema.prisma:188`), so Origio cannot hold the same SKU twice
today. The duplicate problem is **two different spellings of one garment** —
`LIV-KRI-DWN` vs `LIV-KR-JPN-DWN` — which no unique index catches. Only barcode
uniqueness (A4) and near-duplicate *detection* at create (C2) prevent it. Nobody
should propose a SKU unique index as the fix; it exists and it did not help.

---

## 7. Migrations, in order

`main` is production and the Neon database is shared, so every one of these is a
live change. **None to be run without an explicit go.**

| Order | Migration | Additive? |
|---|---|---|
| 1 | `BarcodeAllocation` (A2) | yes |
| 2 | `Colorway.kind` (C3) | yes |
| 3 | `FieldOwner` extensions (C4) | yes |
| 4 | `VariantChannelRef` + `Channel += SITOO` (D2, D3) | yes |
| 5 | **`Variant.barcode @unique` (A4)** | **no — 24 rows cleared in the same migration** |

Migration 5 is the only one that can fail on existing data, and the 24 rows are
already identified.

---

## 8. Suggested first slice

**A1 + A2 + A3.** Barcode helpers, the ledger model, the CFO list loaded into it.
No behaviour changes, one additive migration, and it is the prerequisite for the
unique index, the allocator and the import authority chain alike.
