# Partner API for Loom's Buying planner (plan lock)

Branch `partner-brands-seasons`, 2026-11-12. Base URL `https://origo.livid.no/api/partner/v1`.
Auth: `Authorization: Bearer <ORIGIO_PARTNER_TOKEN>` (the `loom` partner token). Each route needs one scope.

All three calls take `dry_run` (anything but `false` is a dry run, which writes nothing) and return one entry per item, in order.
A refused item comes back as `ok: false` with an `error` written for a buyer. The call itself still succeeds.
Only a malformed call gets a 400 with `{ error }`: no `items` array, or no season, an unknown one or a non-regular one.
Every call is logged in `PartnerCall`.

## Order at lock

1. `POST /brands` for every draft brand on the plan. Loom makes its own Brand row from `origio_brand_id`, `name` and `sku_token`.
2. `POST /external-products` for new styles and colours. A product dry run says "Origio has no brand" until step 1 has run for real, because a dry run of step 1 creates nothing.
3. `POST /season-assignments` for carry-overs, meaning products Origio already has.

## 1. `POST /brands` (scope `brands:create`), new

Request:
```json
{ "dry_run": true,
  "items": [{ "loom_key": "…", "loom_brand_id": "…?", "name": "Converse",
              "sku_token": "CNVR?", "supplier_name": "…?", "currency": "EUR?" }] }
```

Response:
```json
{ "items": [{ "loom_key": "…", "ok": true, "origio_brand_id": "cmwe0sb1p…", "name": "Converse",
              "sku_token": "CNVR", "existed": true,
              "loom_brand_id": "…|null", "is_livid": false, "warnings": [] }] }
```
On refusal: `{ "loom_key", "ok": false, "error" }`.

- **Resolve.** First by `loom_brand_id` (`Brand.loomBrandId`). Then by name, ignoring case, punctuation and spacing. A merged brand resolves to the brand it was merged into.
- **Found.** `existed: true`. A real call links it by setting `loomBrandId`, but only if the brand has no link yet. A brand already linked to a different Loom id is refused.
  - `sku_token` is always the token the brand's SKUs use: its own token, or the derived one when it has none (with a warning).
  - A different `sku_token` in the request is not applied. You get a warning instead.
- **Not found.** Origio creates the brand with `isLivid: false`, an empty `BrandTemplate` (no customs, size system or channels) and a SKU token:
  - the `sku_token` sent, or else the token derived from the name (`abbreviate(name, 4)`, the rule SKUs already use);
  - a token another brand holds is refused, whether stored, derived or seen as `EXT-<token>-` in style SKUs. If the derived token is the one taken, the error asks for `sku_token`; nothing is guessed.
- **Refused:**
  - a name one letter away from an existing brand (a plural or typo). Use the existing name.
  - a name matching more than one brand.
  - any name containing "Livid".
  - reserved tokens (`EXT`, `LIV`, `IMP`, `OLD`, `B2B`, `SMPLS`, `SVD`).
- **Dry run.** Returns the token it would use, with `origio_brand_id: null` for a brand it would create. Two items naming the same new brand get the same answer.
- **Idempotent** by natural key, not by a stored `loom_key`, since that would need a migration. A repeat finds the brand the first call made and returns the same `origio_brand_id`, but with `existed: true`.
- `supplier_name` and `currency` are accepted and ignored: Origio's Brand has no field for them.
- **Added to the brief's shape:** `loom_brand_id`, `is_livid` and `warnings`.

## 2. `POST /external-products` (scope `products:create`), shape unchanged

This already filed each new product in the request's `season` before this branch. Nothing about it changed except one error text.
`finalizeDraft` writes, for that season:
- a `SeasonEntry` (origin NEW, approved for production), with every size linked through `SeasonVariant`;
- NOK `Price` rows: `MSRP = msrp_nok`, `COST = cost_nok`.

A colour the style already has is refused, as before. The message now points at `season-assignments`.

## 3. `POST /season-assignments` (scope `seasons:write`), new

Request:
```json
{ "dry_run": true, "season": "SS27",
  "items": [{ "loom_key": "…", "colorway_sku": "EXT-PB-CRX-AM", "msrp_nok": 2499, "cost_nok": 1000 }] }
```

Response:
```json
{ "items": [{ "loom_key": "…", "ok": true, "colorway_sku": "EXT-PB-CRX-AM",
              "already_in_season": false, "previous_msrp_nok": null, "warnings": [] }] }
```
On refusal: `{ "loom_key", "ok": false, "colorway_sku", "error" }`.

**What a real call writes**, in one transaction per item:
- **Season entry.** If the colourway is not in the season, it gets a `SeasonEntry` with origin `CARRYOVER` and `approvedForProduction: true`. The origin is locked as MANUAL (`authority: loom:buying-plan`) so the classify pass leaves it alone.
- **Existing entry.** It keeps its origin, so a product created NEW in this season stays NEW. If it was dropped (`cancelled`), it is restored, with a warning.
- **Sizes.** Every size is linked to the entry.
- **Prices.** The season's NOK `MSRP` is upserted to `msrp_nok`, and NOK `COST` to `cost_nok` when sent. If the MSRP changes, a warning gives the old value. Other seasons' prices are untouched.
- **Repeats.** A repeat with the same values writes nothing.

**Refused:**
- an unknown `colorway_sku`;
- an `msrp_nok` that is not positive, or a negative `cost_nok`;
- **Livid** colourways, because Threadflow owns their seasons and prices;
- **archived** colourways (status ARCHIVED or archived). Bring them back in Origio first so the channels agree;
- a non-REGULAR season such as CONTINUITY, which gets a 400.

**Nothing is pushed.** The season's MSRP reaches the channels on the next push for that season: the Loom registry payload, the push orchestrator and the Shopify publish all read prices filtered to the batch's season. Loom's existing season price list therefore picks the price up from the registry push.

**Known caveat (not changed here).** `src/lib/sitoo/update.ts` reads the NOK MSRP with `take: 1` and no season filter. A colourway priced in two seasons can therefore send either price to Sitoo on an update.

## Scopes

`PARTNER_SCOPES` in `src/lib/partner/auth.ts` adds `brands:create` and `seasons:write`.
To add them to the existing `loom` token **without rotating it**, run:

```
npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner-token.ts loom --add-scopes brands:create seasons:write
```

Running the script in its mint form (`loom <scopes…>`) replaces the token, and Loom's copy stops working.

## Tests and dry runs

- `npx tsx --test src/lib/partner/partner-rules.test.ts` covers the pure rules: brand matching, token choice and price validation.
- `scripts/partner/dry-run.ts` runs all three calls as dry runs against the database in `.env.local`.
