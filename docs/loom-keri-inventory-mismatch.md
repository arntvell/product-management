# Loom's Keri inventory id points at the wrong product — 2026-09-14

Not the alias. We have never sent an alias to Loom: `buildRegistryColorway`
emits `variant_sku` (the master's own), `barcode`, `dimensions` and the three
channel ids. `VariantChannelRef.externalSku` does not appear in any payload.

**Origio's data is correct.** Every Keri Japan Dawn inventory id resolves in
Shopify to the ACTIVE `keri-japan-dawn`, and each inventory item's own SKU matches
the master's exactly:

```
LIV-KR-JPN-DWN-2432 -> InventoryItem/46023919206649
                       inv.sku = LIV-KR-JPN-DWN-2432, product keri-japan-dawn [ACTIVE]
```

Origio holds one colorway for it, `threadflowId` null — so this is not the split
identity that rejected `LIV-KR-JPN-BLCK`.

---

## What actually happened: we pushed before we aligned the SKUs

At 20:09 Keri went to Loom **with no inventory ids at all** — that work came later
in the evening. SKU was the only Shopify key in the payload. And in Shopify at that
moment:

| Product | Status | SKUs |
|---|---|---|
| `keri-japan-dawn` | **ACTIVE** | `LIV-KRI-DWN-*` |
| `keri-japan-dawn-1` | ARCHIVED | `LIV-KR-JPN-DWN-*` |

We sent `LIV-KR-JPN-DWN-2432`. **That SKU existed in Shopify only on the archived
product.** Anything resolving Shopify by SKU would bind to `keri-japan-dawn-1`,
which is exactly the symptom.

The renames later that evening fixed the source — the ACTIVE product now carries
`LIV-KR-JPN-DWN-*` and the archived one is suffixed — but a binding already made
does not re-resolve on its own.

## And it tells us Loom is not consuming the inventory id

Keri is one of only **34** at-risk variants where we later *did* send a correct
`shopify_inventory_item_id` — and Loom still points at the wrong product. That
matches the other open signal: 355 colorways re-sent with inventory ids for the
first time all came back `updated: 0`.

Two readings, and only Loom can say which: either the field name is not one it
accepts, or it accepts it but resolves stock by SKU regardless.

---

## Blast radius

Of the 9,681 variants in the Archive push:

| | Variants |
|---|---:|
| SKU matched a LIVE Shopify variant at push time | 4,802 |
| **SKU matched ONLY an ARCHIVED variant** | **3,153** |
| SKU on both | 21 |
| In neither — Sitoo-only or not in Shopify | 1,726 |

The 3,153 span **1,117 colorways**, and split sharply:

| | Variants | |
|---|---:|---|
| We sent an inventory id | 34 | Keri Japan Dawn + Keri Black Linen — the families we renamed |
| **We sent no inventory id** | **3,119** | SKU is the only Shopify key Loom has, and it points at an archived record |

So Keri is not special in being wrong — it is special in being the case where we
can *prove* the inventory id was correct and ignored.

---

## What to ask Loom

1. **Does the registry resolve Shopify by SKU or by `shopify_inventory_item_id`?**
   If by SKU, 3,119 variants are bound to archived Shopify records.
2. **Does it store `shopify_inventory_item_id` at all?** `updated: 0` on 355
   colorways that received it for the first time suggests not.
3. **Can existing bindings be re-resolved?** The source is correct now; the
   question is whether Loom will re-read it.

Nothing to fix on our side until those are answered. Origio, Sitoo and Shopify
agree; guessing at Loom's resolution rules and renaming further would risk
splitting products that currently reconcile.

---

## Re-push, 2026-09-14 — it worked, for the families we had realigned

Re-sent the four SKU-aligned families with a **fresh `eventId`** (an identical
resend is deduped into the previous job):

```
sent 4 colorways · 47 variants
created 0 · updated 1 · variantsUpdated 44 · errors 0
```

`variantsUpdated: 44` is the signal. Every previous push of these returned **0**.
Loom re-resolved the variant bindings because the live Shopify product finally
carries the SKU the master sends. Confirmed: Loom resolves Shopify by SKU, and it
had been reading the archived record.

## What that does NOT fix

The same re-push cannot help the rest, because we only realigned four families.
Of the 3,153 at-risk variants:

| | Variants | Shopify link | |
|---|---:|---|---|
| Keri Japan Dawn + Keri Black Linen | 34 | linked | **fixed** |
| No live Shopify presence, in Sitoo | 3,001 | none | still bound to an archived record |
| No live Shopify presence, not in Sitoo | 118 | none | same |

Those **3,119 have no live Shopify variant at all** — their SKU survives only on
an archived product. There is nothing for Loom to re-resolve *to*. We already send
`shopify_inventory_item_id: null` for every one of them, which is the correct
statement: this garment has no Shopify stock object.

**So the remaining fix is Loom's, and it is one rule:** do not fall back to an
archived Shopify record. A variant we send with a null inventory id has no live
Shopify presence, and its stock lives in Sitoo — binding it to a retired listing
attributes movement to a product nobody can sell.

Realigning 1,113 more Shopify SKUs is not the answer here: those products are not
on Shopify any more, so there is no live SKU to align.
