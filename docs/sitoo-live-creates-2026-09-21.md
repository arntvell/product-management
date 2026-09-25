# Publishing to all three channels — Sitoo turned on

2026-09-21. The question was whether the Sitoo credentials that were missing are
now present, and whether the product wizard can publish to Loom, Shopify and
Sitoo. Auth was never the blocker. Three other things were.

## What was actually checked

All three channels authenticate from the running dev server
(`product-management-builder`, the checkout `npm run dev` serves from):

| Channel | Probe | Result |
|---|---|---|
| Sitoo production | `GET /sites/1/products?num=1` | HTTP 200, `totalcount` 14 714, account 91622 |
| Sitoo sandbox | same | HTTP 200, 570 products, account 91624 |
| Shopify | `{ shop { name } }` | HTTP 200, "Livid" / lividjeans.myshopify.com |
| Loom | `GET /api/origio/v1/products?limit=1` | HTTP 200, `rows` returned |

`SITOO_*` has been in `.env.local` since 15 September and the server has held it
since it started at 23:45 that evening — so nothing about authentication changed
between the previous session and this one. "Missing authentication" was the two
deliberate switches below, not a credential.

**What is NOT established: production write scope.** Four barcodes from
`docs/sitoo-push-29.md` were read back from production and all four hold their
post-push values (`LIV-ARMND-BLCK-L` → 7072536081993, `LIV-ML-WHT-L` →
7072536069106, `LIV-TK-WHT-SLK-L` → 7072536086929, `LIV-ARMND-BLCK-S` →
7072536082013). That proves the values **landed**, not that this API key put them
there — a fix made in Sitoo's admin UI reads identically, and
`channel-membership-2026-09-18.md` §5b states plainly that "no product here was
ever pushed to Sitoo from Origio". `createProducts` and `setProductVariants` were
verified against the **sandbox** only.

So the first wizard push will be the first production `POST /products` this
codebase has ever made. If the key turns out to be read-only, it surfaces as a
`FAILED` Sitoo item carrying the 401/403 — retryable, and it cannot affect the
Shopify or Loom legs, which run first and separately. That is a cheap way to find
out, but it is finding out, not knowing.

## The defect this found

`stepSitoo` called `creator.apply(inputs, { dryRun })` and passed **no target**,
so `resolveTarget()` fell through to `SITOO_TARGET` — `sandbox` in every dev
environment. A live batch would have created the garment in account 91624 and
then written those sandbox productids into production
`VariantChannelRef(SITOO).externalId`: the exact corruption `linkSitooProducts`
refuses at `src/lib/sitoo/link.ts:81`, arriving through the door it does not
guard. `createPushBatch` gates the phase on the *production* credentials, so the
batch would have passed its own configuration check and then written elsewhere.

Fixed in three places:

- `stepSitoo` names `production` explicitly rather than inheriting it. The
  sandbox is reachable only by asking — `sitooTarget` on `POST
  /api/catalog/push/batch/[id]/run`, which nothing in the UI sends.
- A sandbox create writes **no** `VariantChannelRef`. That column is a
  production product id; a rehearsal must not leave one behind.
- `apiCreator.apply` checks `SITOO_CREATE_ALLOW_PRODUCTION` **after** the dry-run
  return instead of before it. `plan()` is GETs only, and refusing it made the
  one safe way to look before leaping unreachable: with the API path on, the
  wizard's own Dry run button failed every Sitoo item with the refusal text, so
  the only way to see a plan was to first grant permission to write it.

Consequence worth stating: `SITOO_TARGET=sandbox` no longer shields the batch
path. The two switches below are now the only guard on a production create.

## Turned on

```
SITOO_CREATE_MODE=api
SITOO_CREATE_ALLOW_PRODUCTION=yes
```

Before this, ticking Sitoo in the wizard emitted a CSV worklist and marked the
items `SKIPPED` — honest, but not publishing.

## Verified at runtime, without writing

`CHIMI-ABK-11` was chosen because its SKU exists in production Sitoo (`#14384`)
and **not** in the sandbox, so the two targets give different answers. A
SITOO-only dry run returned:

```
mode: "api"          — the API path is live
error: "every SKU already exists in Sitoo"
```

Only a production read can say that. Under the old code the same run would have
reported the SKU as one to create.

**One of the three changes is observed, not all three.** The target fix is — the
line above is its evidence. The `VariantChannelRef` sandbox guard was not
exercised (a dry run creates nothing, so `created: []`). Neither was the
guard-reordering: `SITOO_CREATE_ALLOW_PRODUCTION=yes` was already set when this
probe ran, so the old ordering would have passed it too. Both rest on typecheck
and reading.

Two `PushBatch` rows are left behind from this (`kind: "probe"`, both noted); the
second reads `FAILED` because "already exists" is how a dry run reports an
existing product. Neither wrote to Sitoo.

## What a new product still needs

- **Manufacturer.** No brand holds more than one Sitoo manufacturer link today
  (54 have exactly one, 7 have none, none have two), so the "refusing to guess"
  failure cannot currently fire. Seven brands will simply create without a
  manufacturer, which Sitoo accepts.
- **Category.** 69 of 93 categories carry a `sitooCategoryId`; the other 24
  create without `defaultcategoryid`.
- **Price.** `moneyprice` comes from the NOK MSRP. No NOK MSRP already blocks the
  Shopify leg, so it will not reach Sitoo silently.

Guards still in force on a live create: the SKU pre-check (a create can never
duplicate something Sitoo holds), and the account-wide product-count tripwire
that aborts on any shrink — the 12 September safeguard.

## Not done

The fix and the two switches are local to `product-management-builder`, on branch
`product-builder`, uncommitted. WORK-DECK D2 (`SITOO_*` absent from the deployed
environment) is unchanged — if the wizard is ever run from a deploy rather than
this laptop, both the fix and the switches have to reach it.
