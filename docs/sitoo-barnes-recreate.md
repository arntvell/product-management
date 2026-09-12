# Recreating the 13 Barnes Japan Dawn variants in Sitoo

13 products (ids 473–485) disappeared from Sitoo between 2026-09-11 and
2026-09-12. Recreate them through the **Sitoo UI**, not the API: the v2 products
API rejects `variantparentid` and `variant` on both POST and PUT, so anything
created through it is a standalone product rather than a size of Barnes Japan
Dawn. There is no variant-group endpoint.

**Try Sitoo support first.** A restore keeps the original ids and the variant
structure, and their audit log will say what removed these and when — which is
worth knowing before anyone writes to Sitoo again.

---

## Shared — identical on all 13

Copy from the surviving sibling `LIV-BRNS-JPN-DWN-2932` (product id 472) rather
than typing these, if the UI offers a duplicate action.

| Field | Value |
|---|---|
| Title / description | Barnes Japan Dawn |
| Price | 2 600.00 NOK |
| Cost (price in) | 889.00 NOK |
| VAT | Standard 25 % (`vatid` 2) |
| Category | Bottoms / Jeans (`defaultcategoryid` 1) |
| Manufacturer | 1 (Livid Men) |
| Delivery class | 1 |
| Variant parent | **175** — Barnes Japan Dawn |
| Active / Active POS | yes / yes |
| Stock count / backorder | enabled / allowed |

## The 13 records

**Use the BARCODE column.** It is what the physical labels carry, confirmed by
two stores on 2026-09-12. The right-hand column is what Sitoo held before —
wrong on seven of them, which is why those sizes would not scan.

| SKU | Waist | Length | Barcode — use this | Sitoo had | |
|---|---|---|---|---|---|
| LIV-BRNS-JPN-DWN-3032 | 30 | 32 | `7072536051729` | 7072536087261 | **was wrong** |
| LIV-BRNS-JPN-DWN-3034 | 30 | 34 | `7072536051781` | 7072536087322 | **was wrong** |
| LIV-BRNS-JPN-DWN-3132 | 31 | 32 | `7072536051736` | 7072536087278 | **was wrong** |
| LIV-BRNS-JPN-DWN-3134 | 31 | 34 | `7072536051798` | 7072536051798 | ok |
| LIV-BRNS-JPN-DWN-3232 | 32 | 32 | `7072536051743` | 7072536087285 | **was wrong** |
| LIV-BRNS-JPN-DWN-3234 | 32 | 34 | `7072536051804` | 7072536051804 | ok |
| LIV-BRNS-JPN-DWN-3332 | 33 | 32 | `7072536051750` | 7072536087292 | **was wrong** |
| LIV-BRNS-JPN-DWN-3334 | 33 | 34 | `7072536051811` | 7072536051811 | ok |
| LIV-BRNS-JPN-DWN-3432 | 34 | 32 | `7072536051767` | 7072536087308 | **was wrong** |
| LIV-BRNS-JPN-DWN-3434 | 34 | 34 | `7072536051828` | 7072536051828 | ok |
| LIV-BRNS-JPN-DWN-3632 | 36 | 32 | `7072536051774` | 7072536087315 | **was wrong** |
| LIV-BRNS-JPN-DWN-3634 | 36 | 34 | `7072536051835` | 7072536051835 | ok |
| LIV-BRNS-JPN-DWN-4034 | 40 | 34 | `7072536051859` | 7072536051859 | ok |

Machine-readable copy:
`snapshots/2026-09-11/worklists/sitoo-recreate-barnes-japan-dawn.csv`

## Still in Sitoo — do not recreate these

| SKU | Product id | Barcode |
|---|---|---|
| LIV-BRNS-JPN-DWN-3834 | 175 (the parent) | 7072536051842 |
| LIV-BRNS-JPN-DWN-2832 | 471 | 7072536051705 |
| LIV-BRNS-JPN-DWN-2932 | 472 | 7072536051712 |

The 16 `IMP-LIV-BRNS-JPN-DWN-*` imperfects under parent 18805 are untouched.

## Stock

All 13 carried **zero units** in the 2026-09-11 snapshot, so no inventory was
orphaned. Worth re-checking against Pio before reopening them for sale.

## Afterwards

Once they are back, re-run the Sitoo linker so the master re-maps to the new
product ids — the old ids are dead and `VariantChannelRef` still points at them:

```bash
curl -sX POST localhost:3000/api/catalog/sitoo/link -d '{"dryRun":true}' | jq
```

The push's SKU guard will refuse to write against a stale id, so nothing can go
to the wrong product in the meantime.
