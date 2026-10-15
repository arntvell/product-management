# Products Loom holds as "sizes" — the un-nesting

2026-10-15. Planned, not applied. `node scripts/nested-split/plan.mjs --all`.

## What happened to a customer

Somebody ordered Bon Parfumeur **602** and received **301**.

Loom holds one product, colourway `EXT-BP`, named "301 Eau de Parfum", with
**fifteen** perfumes as its sizes — `BP101EDP30`, `BP602EDP30`, `901EDP` and the
rest. It carries `pio_product_ref: 344203`, so Pio holds the same shape. A picker
filling an order for 602 opens product 344203, finds a size called `BP602EDP30`,
and takes a bottle from the bin the product is labelled as. The mis-ship is the
structure working exactly as it is built.

## The defect

The pre-2026-09-17 Cin7 importer stripped the last hyphen segment of a SKU and
grouped on the rest. That is correct when the last segment is a size:
`EXT-RW-8085-9.5` really is size 9.5 of the Iron Ranger. It is wrong when the
last segment **is the product** — a perfume number, a Kinto colour, a Steamery
model. So `EXT-BP-BP602EDP30` was read as colourway `EXT-BP`, size `BP602EDP30`.

The clearest single example is Steamery's `EXT-STM-1802`, a box of tumble dryer
balls, which Loom holds as size **"W18/L02"** of a fabric shaver — the 2-D waist
and length parser eating a product code.

This is known. `docs/sku-grouping-fixes-2026-09-17.md` fixed the importer and
named `EXT-BP` among the casualties, then said the existing rows were a separate
repair needing `allow_variant_reparent` and a go-ahead. Red Wing was done
(`docs/red-wing-care-split.md`, 14 variants). The rest was not.

## Origio is already right

Every one of these variants sits on its own colourway with `sizeLabel = "OS"`,
under its own style, with its own distinct and check-digit-valid barcode. 602 is
`3760246980395`, 301 is `3760246980111` — the barcodes were never the problem.

The Loom payload built from today's master carries 68 styles for Bon Parfumeur
and **not one colourway with more than a single variant**. So we would send the
right shape now. Only Loom, and through it Pio, still holds the old one.

That makes this a **reparent**, not a master repair — unlike Red Wing, where 14
colourways had to be created first.

## Scope: 11 parents, 50 variants, 387 units

| Parent | Pio | move | stock moving | What it really is |
|---|---|---|---|---|
| `EXT-BP` | 344203 | 15 | 22 | Bon Parfumeur perfumes |
| `EXT-STM` | 345083 | 8 | 11 | Steamery — incl. dryer balls as "W18/L02" |
| `EXT-FRM` | 344358 | 6 | 14 | Frama apothecary |
| `CHIMI` | 343983 | 5 | 1 | Chimi — sizes named "AVIATOR LIGHT BLUE" |
| `EXT-PF-11` | 344682 | 3 | 58 | P.F. Candle — candle, incense, room spray |
| `EXT-PR-LCT-X10-MC` | 344861 | 3 | 167 | Paraboot laces |
| `EXT-KNT-TBL-350` | 344451 | 3 | 5 | Kinto tumbler colours |
| `EXT-KNT-WB-500` | 344461 | 3 | 0 | Kinto bottle colours |
| `EXT-PF-RDFS` | 344732 | 2 | 93 | P.F. reed diffusers |
| `EXT-STM-CRS` | 345089 | 2 | 16 | Steamery Cirrus colours |
| `EXT-SP` | 345074 | **0** | 0 | already correct — see below |

**0 refusals.** Every variant to be moved resolves to a master colourway, and
every barcode agrees between Loom and the master.

**Three parents own one real product each** and keep it: `EXT-FRM-BDWSH`,
`EXT-SP-OMNIT`, `EXT-STM-LNTBRS`. The plan marks those `stay`. `EXT-SP`'s only
nested-looking variant turned out to be its own, so Saphir needs no repair at
all — it is in the table to record that it was checked.

**`EXT-BP-901EDP` holds negative stock (−1).** That is stock decremented for a
product whose physical bottle is in another bin, which is the same mis-pick this
defect causes. Worth a physical count before anything moves.

## The plan script

`node scripts/nested-split/plan.mjs [--parent=EXT-BP] [--all]`

Read-only. It reads Loom for what is actually nested, resolves each variant
against the master on the stable variant id Loom echoes back (SKU as fallback),
and writes `snapshots/nested-split-plan-*.json`. Nothing is sent to Loom, not
even a validate.

It refuses rather than guesses:

- a variant the master does not know → `refuse`, no colourway to send it to;
- a barcode that disagrees between Loom and the master → `refuse`, because
  moving stock on that assumption turns a mis-ship into a stock error too;
- the parent's own product → `stay`;
- the parent colourway id not matching the one surveyed → the whole run aborts.

The eleven parents are **pinned, not discovered**. A prefix test cannot tell this
defect from an ordinary SKU hierarchy — `LIV` is a prefix of 1,594 colourway SKUs
and is not a bug.

## Applying — not done

Per colourway group, with the destinations from the plan's `push` block:

```
pushColorwaysToLoom(colorwayIds, "CONTINUITY", {
  mode: "data",
  allowVariantReparent: true,
})
```

Loom refuses a reparent by default: the variant row is where stock, weighted
average cost and every order, PO and receipt line live, so a nesting bug upstream
would otherwise relocate all of it silently. Expect `variantsMoved: 50`,
`variantsCreated: 0`, `variantsMoveRefused: 0`. A push reporting
`variantsMoveRefused > 0` is not a success — Loom skips that colourway in
preflight.

Then, in order:

1. **Pio** follows on Loom's side (`pioReparentPending`). Until it does, Pio
   still holds the wrong shape and the mis-ship can recur.
2. **Retire the phantom colourways in Origio.** Eight hold zero variants and are
   pure residue; `EXT-FRM`, `EXT-SP` and `EXT-STM` keep their one real product
   and must not be retired, only renamed to what they actually are.
3. **`EXT-BP`'s style.** The real 301 (`EXT-BP-BP301EDP30`) sits under style
   `EXT-BP`, the bare brand token, while every other perfume has its own style.
   Cosmetic, but it is the residue that made `EXT-BP` a plausible parent.

## Before it runs

- Pio is wrong **now**. The warehouse should know before the repair lands, not
  after — this is the only part that stops another mis-ship today.
- Count `EXT-BP-901EDP` physically; its Loom stock is negative.
- Kinto's three tumbler colours become three separate Loom products, because the
  master holds them as three styles. If they should be one product in three
  colourways, that is a master-side restructure and a different job.
- Kristoffer's go-ahead, which `sku-grouping-fixes-2026-09-17.md` named as the
  gate for exactly this.
