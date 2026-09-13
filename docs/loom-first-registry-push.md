# First push to Loom as the stock registry — 2026-09-13

100 colorways · 87 styles · 1,114 variants · ~5,959 units of confirmed stock.
**Accepted: created 60, updated 40, archived 0.**

---

## What was sent

Livid-brand Continuity product with **every variant barcoded** and confirmed
available stock in Sitoo, largest first — `LIV-KR-JPN-DWN` (21 sizes, 262 units)
down to `LIV-Morin-BK` (5 sizes, 31 units).

The payload is identity only: style, colorway, brand, `channels`,
`registry_only: true`, and per variant `variant_id`, `variant_sku`, `barcode`,
`dimensions`. No prices, no images, no descriptions — the registry reconciles
stock movements, it does not list product.

Validated before transmitting: 1,114 variants, **0 without a barcode, 0 duplicate
barcodes, 0 duplicate variant ids**, all Livid, all `registry_only`.

## Deliberately excluded

The **11 unresolved Threadflow/Cin7 twins**. Loom identifies a product by our own
colorway id, so publishing the Cin7 half of a pair we intend to merge would leave
Loom holding a record that later gets archived while the survivor arrives as new.
`LIV-SRN-JPN-BLCK-DSK` was in the top ten by units and was dropped for this
reason. The pool fell 845 → 834.

## Two defects this surfaced, both fixed

### 1. Registry mode was unreachable through the API

`pushColorwaysToLoom` has accepted `mode: "full" | "data"` all along, and
`purposeForMode("data")` returns `"registry"` — which bypasses the readiness gate
and excludes nobody. **The route never read `mode`**, so every push silently ran
as `"full"`: the wholesale catalogue, Livid-only, readiness-gated.

The first dry run sent **39 of 100**, with 61 skipped for
`missing customs desc, fibre, manufacturer` — exactly the fields the registry does
not need and the 1,175 newly imported colorways do not have. With the route
forwarding `mode`, it is **100 of 100, 0 skipped**.

This is why "Loom as the stock registry" had not happened: the capability existed
and nothing could ask for it.

### 2. Loom does not have a season called CONTINUITY

The first live attempt was rejected: `HTTP 400, Unknown season "CONTINUITY"`,
`sent: 0` — nothing transmitted, no partial state.

Origio models carry-over product as a season called `CONTINUITY`. **Loom calls
that shelf `Archive`.** They are different vocabularies, and `seasonCode` was
doing double duty — selecting which `SeasonEntry`, prices and images to read on
our side, *and* naming the season on theirs.

`loomSeasonName()` now translates only the outbound half. The selection still
uses Origio's own code, or nothing would be found:

| | |
|---|---|
| Origio selects on | `CONTINUITY` |
| Loom receives | `Archive` |

The delivery id is keyed on the season Loom sees, so it changed from
`origio-continuity-aeac2cf8-100` to `origio-archive-cbaacc86-100` — which also
sidesteps the stale-failure rule, where a failed job keeps its id on Loom's side.

## Verified after

| | |
|---|---|
| Loom job `cmu08v2g2000hs60jl3mbeb5t` | `status: done`, created 60, updated 40, archived 0, `unconfirmed: false` |
| `ChannelPublication` in Origio | **100 of 100** `published`, `lastPushStatus: ok` |

60 created and 40 updated means Loom already held 40 of these — consistent with
the 39 that carried a LOOM publication row before this run.

## Next

- The other **734 stocked, fully-barcoded Livid Continuity colorways** in the pool.
- External brands and vintage, which `data` mode now admits and `full` mode does
  not — this is the mode the automated vintage and external pushes need.
- FW26 and SS27, which need no season mapping.
