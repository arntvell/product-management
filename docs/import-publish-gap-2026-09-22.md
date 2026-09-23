# The import flow creates products and never publishes them

2026-09-22. Twenty-four external colourways were imported through
`/catalog/products/import` on the deployed app and appeared in none of Shopify,
Sitoo or Loom. They were created correctly. **No push was ever attempted** — the
import screen has no publish step, and never had one.

## Evidence from the production database

Twelve `ProductDraft` rows reached `COMPLETED` today (10:37 and 11:30), all
with `channels = {SHOPIFY, LOOM, SITOO}`, together creating 24 colourways and 50
variants (49 barcoded).

```
ChannelPublication for those 24 colourways
  SHOPIFY   published=false   lastPushStatus=null   24
  LOOM      published=false   lastPushStatus=null   24
  SITOO     published=false   lastPushStatus=null   24
```

`published=false, lastPushStatus=null` on every row means *targeted, never
pushed* — not *pushed and failed*.

```
PushBatch, entire table
  cmubptd5w08erfw72brpmncua  draftId=null  kind=probe  ok      2026-09-21 18:46
  cmubpx1n80001v572opqxhlyn  draftId=null  kind=probe  failed  2026-09-21 18:49
```

Two rows, both yesterday's Sitoo probes from
`docs/sitoo-live-creates-2026-09-21.md`. **Zero batches for any draft, ever.**
The push machinery has never run for a product created in the app.

## Why — five layers, in the order they bite

**1. The import screen ends at a created count and stops.** `Result` in
`src/components/catalog/import-products.tsx` posts to `/api/catalog/drafts/batch`
with `action: "create"`, toasts a count, and stops. There is no publish button,
no progress, and no link onward. The only push UI in the app is `DraftPushPanel`
on `/catalog/products/drafts/[id]/done`, which the *single-product wizard*
redirects to and the import path never reaches. Ticking Shopify/Loom/Sitoo in
step 2 records intent on the draft; nothing acts on it.

`src/app/api/catalog/drafts/[id]/finalize/route.ts` says so in its own comment:
"Writes the master only. Channel pushes are a separate, retryable step." That is
a deliberate design — a slow Shopify must not half-create a product — but the
import path never offers the second step.

**2. Had the push run, all 24 would have been held back.** `createPushBatch`
gates Shopify on `shopifyMissing`, which wants description, image, tags, swatch,
care page and fit guide on top of variants and price. All 24 have variants and a
NOK MSRP; **all 24 are missing all six merchandising fields.** They would each
come back `BLOCKED` (waivable), and the Loom leg blocks behind Shopify
("waiting on the Shopify push for its inventory ids"), so nothing would go out
until someone pressed "Push anyway".

This is structural, not an operator omission: `IMPORT_COLUMNS` is exactly
`Style, Colorway, Size, Price in, Price out, Barcode, Category`. The template
cannot carry a description or a photograph, so an imported product can never
satisfy the gate from its own file.

**3. Shopify would receive a DRAFT product.** `finalize.ts:428,491` hardcodes
`status: "DRAFT"` on every colourway it creates, and `push-shopify.ts` forwards
that status. All 24 read `ProductStatus.DRAFT` today. A pushed product would show
in the Shopify admin but not on the storefront.

**4. Sitoo is probably skipped on the deploy.** `createPushBatch` marks Sitoo
`SKIPPED` when `SITOO_API_ID` / `SITOO_API_KEY` / `SITOO_BASE_URL` are absent, and
a live create additionally needs `SITOO_CREATE_MODE=api` and
`SITOO_CREATE_ALLOW_PRODUCTION=yes`. All five are set in
`product-management-builder/.env.local` only;
`docs/sitoo-live-creates-2026-09-21.md` closes with "if the wizard is ever run
from a deploy rather than this laptop, both the fix and the switches have to
reach it", and WORK-DECK D2 records `SITOO_*` as absent from the deployed
environment. **Unverified from here** — no Vercel CLI, no `.vercel` link.

**5. And the Loom leg would have sent nothing anyway.** No caller passes
`seasonCode` when creating a batch — not the import screen, not `/done`. So
`PushBatch.seasonCode` is null, `submitLoom` falls back to `"CONTINUITY"`, and
`pushColorwaysToLoom` reports every colourway as `not in season CONTINUITY`.
**All 24 are FW26** (`SeasonEntry`, confirmed). Those items become `SKIPPED`,
and `finish()` counts SKIPPED as neither ok nor failed — so the batch would have
reported `status: "ok"` with Loom untouched. The same bug as layer 1, one
channel over. It also costs Shopify its season-scoped price: `push-shopify.ts`
warns "Pushed without a season — price is not season-scoped".

Checked, and *not* a sixth layer: passing `FW26` also narrows the price lookup
`createPushBatch` uses for its hard `hasPrice` gate. Both the NOK MSRP and the
NOK COST of all 24 are on FW26, so naming the season keeps that gate satisfied
rather than flipping them to non-waivable BLOCKED.

## The 24 colourways, still unpublished

```
EXT-HST-BRGVK-ESPRS   EXT-HST-ELS-BLCK    EXT-HST-JHN-BLCK    EXT-HST-OTR-LGHT-PNK
EXT-HST-RBRT-TFF      EXT-HST-TR-MTT-BLCK EXT-PNT-AGTH-CRM    EXT-PNT-AGTH-DRK-CML
EXT-PNT-AGTH-OLD-RS   EXT-PNT-BCK-ANTHR   EXT-PNT-BCK-DRK-BRWN EXT-PNT-BCK-NTRL
EXT-PNT-BCK-RCNG-GRN  EXT-PNT-CL-LGHT-BG  EXT-PNT-CL-MRN      EXT-PNT-CL-TL
EXT-PNT-CRMFR-DRK-BRWN EXT-PNT-CRMFR-DRK-CML EXT-PNT-RS-CHCLT EXT-PNT-RS-TRTN
EXT-PNT-THRNH-ANTHR-FLCK EXT-PNT-THRNH-DRK-BRWN-FLCK
EXT-PNT-THRNH-NTRL-FLCK  EXT-PNT-THRNH-NVY-FLCK
```

All external brands (`Brand.isLivid = false`). The Loom leg pushes with
`mode: "data"`, which is the stock *registry* — externals are eligible there, so
Loom is not the problem for these; the wholesale catalogue would have refused
them, and the orchestrator does not use it.

## What was changed — branch `import-auto-publish`

Creating a product now publishes it.

- `api/catalog/drafts/batch` returns each created draft's `colorwayIds`. Without
  them the import screen knows it created something and not what.
- `DraftPushPanel` generalised: `draftId` may be null (an import batch spans many
  drafts), plus `kind`, `note`, `allowIncomplete`, `autoStart` and
  `onBatchCreated`. The `autoStart` guard is a ref, because a second render
  minting a second batch is a duplicate product in Shopify.
- The import result screen renders that panel and starts a **live** push the
  moment "Create and publish all that pass" finishes creating. The button was
  renamed because its blast radius changed from the database to three outside
  systems. Held-back items still appear with the existing "Push anyway" waiver;
  nothing goes out unreviewed that did not before.
- `allowIncomplete` is passed for the import path — see the decision below.
- `seasonCode` is plumbed from the screen to the batch: the import screen sends
  the season chosen in step 1, and `/done` reads it off the draft payload. This
  is the fix for layer 5 and it repairs the pre-existing `/done` path too.
- The batch id goes into the URL (`/catalog/products/import?batch=…`) and the
  page resumes from it. An import batch has `draftId: null`, so no `/done` page
  can find it, and a Loom job outlives the tab that submitted it.
- Copy: rows read "created · not published" until a batch exists, and a created
  draft's link goes to its `/done` page.
- `/done` waives the same gaps when the draft came from a file
  (`payload.origin === "import"`), so one product does not meet two different
  gates depending on which screen its operator was on.
- A `?batch=` whose batch has finished is not offered for resume — the page
  checks `status in (pending, running)`, as `/done` already did.

Known and left: the per-row label stops at "created · publishing" and never
flips to "published" — the batch's progress lives in the panel, not in the row
list. The panel's own per-channel counts are the honest readout.

Typecheck and lint clean. The import page and the resume view were rendered
against the running dev server. **The create-and-push path itself was not
exercised** — doing so writes real products to Shopify, Sitoo and Loom.

## Do Loom and Sitoo work off what the import flow captures?

Checked against the 24, field by field. **Yes**, on the branch.

**Loom.** The orchestrator pushes `mode: "data"` — the stock *registry*, which
bypasses `loomMissing` entirely ("it carries identity, not a sellable listing")
and excludes nothing on eligibility. What it does require:

| Requirement | State |
|---|---|
| Colourway present in the season pushed | FW26 on all 24 — **only with the branch's `seasonCode`**; `main` sends CONTINUITY and skips all 24 |
| Barcoded variant | 49 of 50. `EXT-HST-RBRT-TFF-11` has none and is invisible to the feed (`payload.ts:198`) |
| `shopify_inventory_item_id` | Comes from the Shopify push — see the condition below |
| Customs block | Complete on all 12 styles: HS code, customs description, weight, fibre, and origin on every colourway |

**Sitoo.** `api-creator.plan()` blocks on exactly two things — "no sizes" and
"every SKU already exists". Neither applies. And what would have arrived thin
does not:

| Field | State |
|---|---|
| `manufacturerid` | Hestra and Pantherella each have exactly one `BrandChannelRef(SITOO, BRAND)` — resolved, and no ambiguity failure |
| `defaultcategoryid` | All four categories carry one: Gloves Men 43, Gloves Women 44, Socks Men 17, Socks Women 19 |
| `moneyprice` / `moneypricein` | FW26 NOK MSRP and COST on all 24 |
| `active` / `activepos` | Both `true` — Sitoo goes live at the till immediately |

**The condition: Shopify still has to be pushed.** Loom's
`shopify_inventory_item_id` is read from `VariantChannelRef(SHOPIFY)`, which
only the Shopify push writes. Unticking Shopify does not hold Loom back — it
sends anyway, with nulls, and the stock link silently does not reconcile. On this
branch the Shopify leg pushes and lands a **DRAFT** product: in the admin, not on
the storefront, which is what "not published immediately" means here.

## Four decisions that are yours

**a. Waive the merchandising gaps on import?** Implemented as yes, because the
template has no column that could fill them and a button that must always be
pressed is not a decision. It is safe as long as (b) stays DRAFT: a Shopify draft
product is not on the storefront. Say the word and it becomes a visible checkbox
instead, or a lighter `shopifyMissing` for non-Livid brands.

**b. Should imported products be Shopify DRAFT or ACTIVE?** Left at DRAFT.
"Automatically published" reads as ACTIVE, but these have no description and no
photograph, and DRAFT is what makes (a) safe. If you want them live, the honest
order is: fill the merchandising fields, then activate.

**d. The first Loom push carries `sitoo_product_id: null`.** `PHASES` is
SHOPIFY → LOOM → SITOO, and the Sitoo ref is written in the last phase, so Loom
hears about the product before Sitoo has an id for it. `declareChannel` already
sends `sitoo: true` up front, which is the `channel_declared_absent` state Loom
asked to be able to raise — so this is reported, not silent, and a second data
push fills the id. The tidier fix is SHOPIFY → SITOO → LOOM, but that reorders
every batch path and the declare-up-front comment suggests the current order was
chosen, not stumbled into. Left alone deliberately; worth its own look.

**c. The Vercel production environment.** Confirm `SITOO_API_ID`,
`SITOO_API_KEY`, `SITOO_BASE_URL`, `SITOO_CREATE_MODE=api` and
`SITOO_CREATE_ALLOW_PRODUCTION=yes` are all set there. Without them every deploy
push skips Sitoo, honestly and silently. Note also that the first production
`POST /products` this codebase makes is still unproven — write scope was only
ever verified against the sandbox.

## The 24 waiting products

Two ways, and they are not equivalent:

- **Today, on `main`:** twelve `/done` pages, "Push to channels", then "Push
  anyway" on each. Shopify and Sitoo would go out — but `seasonCode` is null on
  `main`, so **Loom silently skips all 24** as `not in season CONTINUITY`. Layer
  5 is not fixed on `main`.
- **Once this branch lands:** one push from the import screen, or one `/done`
  page each with the season attached, and all three channels are reached.

Confirmed still true on 2026-09-23: `PushBatch` holds the same two probe rows,
all 72 `ChannelPublication` rows read `published=false / lastPushStatus=null`,
and these colourways have **zero** `VariantChannelRef` of any system. Nothing has
been pushed by anyone.

The safe next step either way is a **dry run** of a batch over the 24 from this
branch: one `PushBatch` row, nothing written outward, and it exercises the season
plumbing and the deployed Sitoo configuration for real. Everything past that
writes to production Shopify, Sitoo and Loom — and it would be this codebase's
first ever production `POST /products` to Sitoo — so it wants a decision first.
