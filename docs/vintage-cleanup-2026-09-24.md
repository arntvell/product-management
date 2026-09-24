# Vintage cleanup — 2026-09-24

Input: `products-2026-09-23.xlsx`, a Loom export of the 263 Vintage store SKUs,
marked up by Kristoffer: red rows = legacy products to archive, blue columns
(Colorway name, Category) = new values. Copy kept at
`snapshots/vintage-cleanup-input-2026-09-23.xlsx` (gitignored, like all snapshots).

Scripts: `scripts/vintage-cleanup/` — `plan.mjs` (read-only) → `sitoo.mjs categories`
→ `apply-origio.mjs` → `push-loom.mjs` → `sitoo.mjs products`. Each dry-runs by
default; `sitoo-sandbox-check.mjs` proved the Sitoo writes first.

## Decisions (Kristoffer, 2026-09-24)

- **Red rows with stock on a live Sitoo product are held**, not archived: Loom will
  not withdraw a stocked SKU and an inactive Sitoo product cannot be rung up.
- **Names:** the sheet's title case, but abbreviations keep their capitals
  (US, RL, LLW, XL, Y2K, OG-107; "PiP" as written). One-size vintage: style name =
  colourway name.
- **New categories are created in Sitoo** as well as Origio.
- **SKUs untouched.** The sheet's style number for the Selected Kimono had been hit
  by a find-and-replace on "Johanne"; ignored.

## What was written

| System | Result |
|---|---|
| Origio | 199 styles + 203 colourways renamed/recategorised, 11 archived (`archived`, `ARCHIVED`), 6 categories created (Footwear, Market, Mix, Selected, Shirt Long Sleeve, Shirt Short Sleeve), 545 MANUAL locks (`manual:vintage-cleanup-2026-09-24`) |
| Loom | one registry job (`archv`, mode `data`): 184 updated, 11 archived, 0 item errors |
| Sitoo | 5 categories created (Footwear 84, Mix 85, Selected 86, Shirt Long Sleeve 87, Shirt Short Sleeve 88; Market = existing 82). 164 product writes: 77 titles, 138 categories, 5 deactivated (`active`/`activepos` false). POPUP (83) membership kept. Product count unchanged (14,756) |
| Shopify | none of the 263 SKUs exist there — nothing to do |

Loom: 192 updates were sent, of which 10 were no-ops by construction — no name
change, and old/new category collapse to the same Loom value (T-Shirt→Tee and
Sweatshirt→Jersey are both Jersey, Jacket→Coat both Outerwear, Cap→Accessories).
Loom reported 184 updated against 182 real changes, with 0 item errors.

Sitoo titles that already differed from Origio were overwritten with the master's
new name — before-values are in `snapshots/vintage-cleanup-sitoo-before-*.json`:

| SKU | Sitoo before | Now |
|---|---|---|
| `EXT-VN-NW-SLK-SQSCRF` | SILK SCARF (SQUARE) | Silk Scarf |
| `EXT-VN-NW-JHS-JK` | SELECTED JACKET | Selected Jacket |
| `EXT-VN-SCTVRS-OS` | Selected varsity, OS | Selected Varsity |
| `EXT-VN-NW-LLW-DN` | Branded Denim Shirt | LLW Shirt Denim |

Only POPUP (83) was kept as a secondary Sitoo category; `VN-WOSKT-OS` lost its
secondary 69 (Sweatshirt).

Re-running `plan.mjs` afterwards finds 0 renames and 0 recategorisations left.

## Still open

- **8 held** (red, but stocked in Sitoo): `EXT-VN-SLK-PRNTSHRT` 35, `EXT-VN-NW-HWP` 32,
  `EXT-VN-NW-BLS` 11, `VIN-JNS-HW` 2, and 1 each on `EXT-VN-NW-JHS-JK`,
  `VIN-BRNDNLNJK`, `VIN-MXVST-499`, `EXT-VN-NW-LLW-DN-SLCT-OS`. Renamed and
  recategorised, not archived. Write off / move the stock, then re-run with them.
- **Orphan Sitoo stock** on 5 archived SKUs whose Sitoo product no longer exists
  (2022–23 rows, mostly Livid Kontor / Reclaim): `VIN-SLKBLS-399` 22,
  `VIN-FLC`, `VIN-LVS-DNMJKT`, `EXT-VIN-PR-CRDG`, `VIN-UNBRNDDNSRT` 1 each.
- New categories have no `loomCategory`, so the registry receives them as written
  (as Blouse, Bottoms etc. already are). Set one on /catalog/categories if Loom's
  catalogue should group them.
