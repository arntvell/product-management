# Partner API for Loom's Buying planner (plan lock)

Branch `partner-brands-seasons`, 2026-11-12. Base URL `https://origo.livid.no/api/partner/v1`.
Auth: `Authorization: Bearer <ORIGIO_PARTNER_TOKEN>` (the `loom` partner token). Each route needs one scope.

Every call takes `dry_run` (anything but `false` is a dry run, which writes nothing) and return one entry per item, in order.
A refused item comes back as `ok: false` with an `error` written for a buyer. The call itself still succeeds.
Only a malformed call gets a 400 with `{ error }`: no `items` array, or no season, an unknown one or a non-regular one.
Every call is logged in `PartnerCall`.

## Order at lock

1. `POST /brands` for every draft brand on the plan. Loom makes its own Brand row from `origio_brand_id`, `name` and `sku_token`.
2. `POST /external-products` for new styles and colours. Send `brand.origio_brand_id` from step 1. In a dry run, a brand still a draft in Loom's plan is previewed (see section 2); a real call needs step 1 to have run for real.
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

## 2. `POST /external-products` (scope `products:create`), brand block extended

Two changes, both additive, as the Loom session asked:

```jsonc
"brand": { "origio_brand_id": "cmwe…?", "loom_brand_id": "…?", "name": "Converse", "sku_token": "CNVR?" }
```

- **Resolve.** `origio_brand_id` first (a merged brand follows to the brand it was merged into), then `loom_brand_id`, then the normalised name. These are the same rules as `/brands`, so a brand that call answered for always resolves here. The name match used to be exact and case-insensitive, and skipped archived brands.
- **Dry run for a draft brand.** If no Origio brand matches, the SKUs are previewed with `sku_token`, or else the token `/brands` would derive. The answer is `ok: true` with a warning naming the token. A token `/brands` would refuse is refused here too.
- **Real call for an unknown brand.** `ok: false`, "create it through POST /brands first".
- **Loom id.** A real call that finds the brand by name records `loom_brand_id` on it. A dry run no longer does.

**SKUs (2026-11-12).** A new product's `colorway_sku` is always `EXT-<brand token>-<style tokens>-<colour tokens>`, built from `style_name` and `colour`. This holds even when the colour joins an existing style. Older style SKUs are not inherited, because they carry an old colour (`EXT-KEEN-JAS-ATBR`) or `LIV-STY-`. With no `colour`, the SKU is the style stem alone. The collision checks are unchanged. A clash is refused, never suffixed around.

Proof from data that the season filing already worked before this branch: Loom-born `EXT-PB-TSTMD-ZT-NR` (loom_key `origo-test-zeta-1`) has an SS27 entry (NEW, approved, 3 sizes) and SS27 NOK MSRP 4500 / COST 1500.55.
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

`colorway_sku` is looked up as sent, then in normalised form. 170 older SKUs are not stored normalised.

**Refused:**
- an unknown `colorway_sku`;
- an `msrp_nok` that is not positive, or a negative `cost_nok`;
- **Livid** colourways, because Threadflow owns their seasons and prices;
- **archived** colourways (status ARCHIVED or archived). Bring them back in Origio first so the channels agree;
- a non-REGULAR season such as CONTINUITY, which gets a 400.

**Nothing is pushed.** The season's MSRP reaches the channels on the next push for that season: the Loom registry payload, the push orchestrator and the Shopify publish all read prices filtered to the batch's season. Loom's existing season price list therefore picks the price up from the registry push.

**Known caveat (not changed here).** `src/lib/sitoo/update.ts` reads the NOK MSRP with `take: 1` and no season filter. A colourway priced in two seasons can therefore send either price to Sitoo on an update.

## 4. `POST /colorway-sizes` (scope `products:create`), new 2026-11-13

For a size the buyer adds to a line of a product Origio already has. Loom calls it at create POs, after `external-products` and before `season-assignments`. Branch `partner-colorway-sizes`.

Request:
```jsonc
{ "dry_run": true,
  "season": "SS27",            // optional, see "Season" below; Loom does not send it yet
  "items": [{ "loom_key": "<buying line id>", "colorway_sku": "EXT-PRB-CMB-NR", "sizes": ["12"], "cost_nok": 2343.2, "msrp_nok": 6900 }] }
```

Response:
```jsonc
{ "items": [{ "loom_key": "…", "ok": true, "colorway_sku": "EXT-PRB-CMB-NR",
              "variant_skus": { "12": "EXT-PRB-CMB-NR-12" },   // keyed by the labels sent
              "existing": [],                                  // asked sizes it already had
              "warnings": [],
              "style": { /* real call only: FeedStyle of the WHOLE colourway */ } }] }
```
On refusal: `{ "loom_key", "ok": false, "colorway_sku", "error" }`.

**What a real call writes.** It adds one `Variant` per missing size, with no barcode, linked to the same season entries as its siblings. That is all it writes:
- nothing goes to Shopify, Sitoo or Loom;
- `ChannelPublication`s are untouched;
- no prices: Origio prices a colourway per season, so `cost_nok` and `msrp_nok` are accepted and ignored. The season price comes from `season-assignments`.

The whole item is written in one transaction, or nothing is.

**The size.** It must be in the colourway's size system. The system is chosen as the add-size flow chooses it: the draft that created the colourway, then the brand's default, then a system that holds all its sizes.
- The size system's spelling and SKU token are used. `"42,5"` and `"42.5"` are the same size.
- A label the system lacks is **refused**, and the error lists the sizes it has. Origio's Paraboot Chambord (`EXT-PRB-CMB-NR`) is sized UK 7–11, so an EU `46` from the planner is refused, not added beside them.
- A label is taken as written only when no size system fits the colourway at all, and never for a waist × length colourway.
- A size retired from the system is refused.

**The SKU** is the siblings' stem plus the size token (`skuStemFor` from add-size). It is refused when:
- the siblings disagree on a stem;
- another colourway holds the SKU (`collision: <sku> exists on <colourway>`);
- two asked sizes give one SKU.

**Idempotent** by construction, with no table and no migration. A size the colourway already has is a no-op, matched by label or by SKU, and is returned with its SKU in `existing`.
- A repeated real call writes nothing and returns the same SKUs and the same style.
- If two calls race on one size, the loser re-reads and answers from what the winner wrote.

**`style`** is built by `buildLoomPayloadFromColorways` in full mode, the builder behind the catalogue push. It contains every variant with its `variant_id`, because Loom applies it in full mode and full mode drops the sizes a payload leaves out.
- `channels` are what the colourway has, so a carry-over live on Shopify or Sitoo stays declared there.
- `approved_for_production: true` and `dropped: false` are always sent. Loom applies the style to the plan's season, and its feed engine writes approved from the payload, treating absent as false. Loom calls this before `season-assignments`, so the colourway usually has no Origio entry in that season yet. The plain builder would then send `false` and un-approve the line in Loom.

**Season.** `season` is optional. When it is sent, the style carries that season's NOK MSRP and main image. Without it, `prices` is `{}` and `image` is `null`, and Loom keeps what it has for both. An unknown season is a 400.

**Refused per item:** an unknown colourway (looked up as sent, then normalised), Livid/Threadflow colourways, archived ones, non-merchandise records, no sizes.

**Not handled here (follow-up).** A size added here reaches Shopify and Sitoo only when someone carries it there. Once its barcode arrives through `variants/master-data`, the add-size page (`/catalog/products/new/size`) lists it under sizes missing from a channel and propagates it. Until then Loom holds a variant with no Shopify or Sitoo link on a colourway declared for both, so its stock hub may flag the size.

Tests: `src/lib/partner/colorway-sizes.test.ts`, which uses an in-memory store and the real payload builder. Dry run against the database: `scripts/partner/dry-run-sizes.ts`.

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
