# Recreating the 13 Barnes Japan Dawn variants in Sitoo

13 products (ids 473–485) disappeared from Sitoo between 2026-09-11 and
2026-09-12.

> **Correction, 2026-09-16.** The paragraph that stood here said to recreate
> these through the UI because "the v2 products API rejects `variantparentid`
> and `variant` on both POST and PUT … there is no variant-group endpoint."
>
> The rejection is real — both fields are `readOnly` — but the conclusion was
> wrong. **A variant family IS creatable through the API**, just not through the
> field the first attempt reached for:
>
> ```
> POST /sites/{site}/products                          creates; `sku` is the
>                                                      only required field
> PUT  /sites/{site}/products/{parent}/productvariants  sets the family
> ```
>
> Verified end-to-end against the sandbox by
> `scripts/check-sitoo-create.ts`: three products created, the family set, all
> three read back carrying `variantparentid` pointing at the main variant, the
> size group present with all three options, and the account count up by exactly
> three. `src/lib/sitoo/create/` implements it, gated behind
> `SITOO_CREATE_MODE=api` with a worklist fallback as the default.
>
> Recreating these 13 through the UI is still reasonable — a restore keeps the
> original ids — but it is now a choice, not a limitation.

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

| Full SKU | Waist | Length | Barcode — use this | Friendly URL | Sitoo had |
|---|---|---|---|---|---|
| `LIV-BRNS-JPN-DWN-3032` | 30 | 32 | `7072536051729` | `barnes-japan-dawn-3032` | 7072536087261 **wrong** |
| `LIV-BRNS-JPN-DWN-3034` | 30 | 34 | `7072536051781` | `barnes-japan-dawn-3034` | 7072536087322 **wrong** |
| `LIV-BRNS-JPN-DWN-3132` | 31 | 32 | `7072536051736` | `barnes-japan-dawn-3132` | 7072536087278 **wrong** |
| `LIV-BRNS-JPN-DWN-3134` | 31 | 34 | `7072536051798` | `barnes-japan-dawn-3134` | same |
| `LIV-BRNS-JPN-DWN-3232` | 32 | 32 | `7072536051743` | `barnes-japan-dawn-3232` | 7072536087285 **wrong** |
| `LIV-BRNS-JPN-DWN-3234` | 32 | 34 | `7072536051804` | `barnes-japan-dawn-3234` | same |
| `LIV-BRNS-JPN-DWN-3332` | 33 | 32 | `7072536051750` | `barnes-japan-dawn-3332` | 7072536087292 **wrong** |
| `LIV-BRNS-JPN-DWN-3334` | 33 | 34 | `7072536051811` | `barnes-japan-dawn-3334` | same |
| `LIV-BRNS-JPN-DWN-3432` | 34 | 32 | `7072536051767` | `barnes-japan-dawn-3432` | 7072536087308 **wrong** |
| `LIV-BRNS-JPN-DWN-3434` | 34 | 34 | `7072536051828` | `barnes-japan-dawn-3434` | same |
| `LIV-BRNS-JPN-DWN-3632` | 36 | 32 | `7072536051774` | `barnes-japan-dawn-3632` | 7072536087315 **wrong** |
| `LIV-BRNS-JPN-DWN-3634` | 36 | 34 | `7072536051835` | `barnes-japan-dawn-3634` | same |
| `LIV-BRNS-JPN-DWN-4034` | 40 | 34 | `7072536051859` | `barnes-japan-dawn-4034` | same |

All 13 friendly URLs are **free** in Sitoo — checked against all 14,701 live products.

The friendly format follows the parent record, product 175, which is
`barnes-japan-dawn-3834`. Note that the other two survivors do not: 471 and 472
carry `barnes-japan-dawn-liv-brns-dwn-2832` and `-2932`. Worth tidying those two
to match while you are in there, so the whole family reads consistently.
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
