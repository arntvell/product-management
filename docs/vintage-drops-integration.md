# Vintage drops in Origio — integration design

**Status:** proposal, nothing implemented.
**Branch:** `vintage-drops`, now level with `main` @ `499be15` (fast-forwarded
2026-09-07; the original `48c4137` cut point is history).
No migration run, no code changed, not pushed.

**Revised 2026-09-07** against the code actually on `main`. §§2, 3, 6, 7, 8 and 10
changed materially — several of the original assumptions were wrong, and one whole
premise (§2) is dead. Claims marked *verified* were read in the source cited. §§4,
5, 9 and the appendix concern the Google Sheet and the image host, neither of which
is in this repo; they are unchanged and still unverified.

Goal: fold the vintage-drop workflow (currently a Google Sheet + sFTP + Matrixify)
into the product master, without disturbing the Threadflow/Cin7/Shopify pipeline
that already works.

---

## 1. Why Origio is the right home

The vintage sheet is, functionally, a **second product master**: it holds canonical
product data, enriches it per channel, and pushes to Shopify and Cin7. Origio
already does all of that — Postgres canonical store, hardened Shopify push with
idempotent media, a Cin7 client, Vercel Blob, dry-run discipline. Vintage does not
need new infrastructure; it needs a new `Source` and an entry UI.

What it removes: double entry, the copy-sheet-save-as-CSV step, the Matrixify
upload, and the class of silent failure that broke the September 2026 drop (a dead
image URL that no system complained about).

---

## 2. Sequencing — read this before planning any work

**Rewritten 2026-09-07. The original premise of this section is dead.**

This doc was drafted against `48c4137`, where `main` was the legacy editor and the
product master lived only on `phase-0-product-master`. That is no longer the repo:

- `d557113` (2026-09-01) **merged `phase-0-product-master` into `main`.**
  `git merge-base --is-ancestor origin/phase-0-product-master origin/main` passes —
  phase-0 is fully contained in `main`, which is now 5 commits ahead of it.
- **ONBOARDING §1 is stale.** It still says the master work lives *only* on phase-0
  and "never merge the master branch into `main` yet". ONBOARDING has not been
  touched since `48c4137` (2026-08-25), six days before that merge. Git is the
  authority; ONBOARDING §1 needs its own correction, out of scope here.

Per ONBOARDING, `main` deploys to production on Vercel. **Whether production has
actually been redeployed since `d557113` cannot be determined from the repo** —
check the Vercel dashboard before relying on either answer. Plan for the stricter
case: assume the master schema is live on the production branch.

Vercel still gives `vintage-drops` its own preview deployment, which is how the
module gets used before it merges. Keep the branch rebased on `main` — which it now
is — so the merge back stays a fast-forward. **The merge-back target is `main`, not
phase-0.**

### What the branch does NOT isolate: the database

Per ONBOARDING, there is **one shared Neon Postgres**. Branches isolate code, not
data. A migration run from `vintage-drops` lands in the same database that
production-branch code reads. The consequences are the same as when this was
drafted, but they are no longer branch hygiene — they are production hygiene:

- **Additive migrations only on this branch.** Adding `VINTAGE` to the `Source` enum
  is backward-compatible: no existing code selects it. Verified — `Source` today is
  `THREADFLOW | MANUAL | SHOPIFY_IMPORT | CIN7_IMPORT` (`schema.prisma:350`).
- **No renames, drops, or column type changes** here. Previously that would have
  broken "a branch nobody is watching"; now it can break production.
- Vintage rows become visible to the master UI and pipeline the moment they exist,
  which is exactly why the §6 guards must ship *with* the migration, not after.

Until the vintage module is real, **the Google Sheet keeps running drops.** The interim improvements are cheap and independent of this
document:

- `=IMAGE("https://vintage.lividjeans.com/"&A3&".jpg")` next to the INPUT rows —
  visual QA today.
- An Apps Script pass that probes `-2`/`-3` and fills the `;`-joined `Image Src`,
  fixing the "only one photo imports" problem.

Build Origio vintage *behind* the working sheet and cut over deliberately (§9 —
the original text said §8; the cut-over section is §9).
Do not let the migration break the next drop.

---

## 3. The model already fits

### Open question, unresolved — settle this before step 1

**Vintage is not new to Livid, only new to Origio.** Years of vintage products
already live in Shopify, and this repo already routes around them in three places:

- `src/lib/master/import-shopify.ts:192` — the Shopify importer is vendor-scoped
  *precisely* to keep vintage out: *"the Shopify catalogue mixes in vintage,
  fit-guide pages, and past-season Livid goods — never blanket-import"*.
- `src/components/catalog/import-panel.tsx:142` — the UI tells the operator to leave
  those vendors unchecked.
- `src/lib/grouping.ts:7` — the legacy editor excludes `/vintage|used|preloved/i`
  from auto-grouping by product type, title, or tag.

**Nobody has decided whether Origio owns the vintage back-catalogue or only new
drops from cut-over forward.** This doc silently assumes the latter. That may well be
right — but it is an assumption, not a finding, and it should be made explicitly
because it has a concrete failure mode:

> If anyone ever ticks vendor **`Vintage`** in the Shopify importer, those products
> land as `source = SHOPIFY_IMPORT` in the CONTINUITY season, carrying the same
> `VN-ONLN-<nummer>-OS` variant SKUs that §7 assigns. `Style.styleSku`,
> `Colorway.colorwaySku` and `Variant.variantSku` are all `@unique`, so those rows
> and future `VINTAGE`-sourced rows compete for the same keys, and which one wins
> depends purely on which ran first.

Two things follow, whichever way the decision goes: the SKU scheme below is
**load-bearing, not cosmetic**, and `Vintage` should be excluded from the Shopify
importer's vendor list in code rather than by operator discipline.

### The model itself

No new models are needed. This is the finding that makes vintage cheap, and it
survives the re-check — with one row improved by work that landed since:

| Vintage concept | Origio model |
|---|---|
| Item number (`13644`) | `Colorway.colorwaySku` (already `@unique`) |
| One-of-one garment | `Style` → one `Colorway` → one `Variant`, size `OS`, qty 1 |
| Photos | `MediaAsset`, `source = EXTERNAL`, `position` 1..n, `role = GALLERY` |
| Drop number | **`SeasonEntry.drop`**, stored as `"Drop <n>"` — see below |
| The vintage pool | one `Season`, code `VINTAGE`, `kind = CONTINUITY` — **not** the existing CONTINUITY season; see below |
| Selling price (`Pris nett`) | a `Price` row on the `VINTAGE` season, `NOK`/`MSRP` |
| Hand-written copy | `FieldOwner` `MANUAL` lock on every field the UI writes |
| Sold / withdrawn | `Colorway.archived` (whole-channel), not `SeasonEntry.cancelled` |

**Drops are first-class now.** The original draft said "tag `DROP<n>`, not a new
model". That was true at `48c4137` and is no longer: migration
`20260902153006_season_entry_drop` added `SeasonEntry.drop` — free text, indexed
`[seasonId, drop]`, with `src/lib/master/drops.ts` and `POST /api/catalog/drops`
already able to assign a drop by selection or by pasted handle list. **Store the
human label** — `"Drop 1"`, `"Drop 2"`, matching the schema comment's own examples and
what the drop board displays — and derive the tag form at push (§7), rather than
storing `DROP1` and un-mangling it for the UI. Vintage should
**store the drop on the entry and derive the `DROP<n>` tag at push** (§7), not carry
it only as a tag. The payoff is immediate: the existing drop board becomes the §10
step-2 QA view for free, scoped to season `VINTAGE`.

**Which season — and it is not a free choice.** `docs/vintage-workflow.md` §4 puts
vintage in the **existing** `CONTINUITY` season (reusing `create.ts`'s upsert). That
is the one place the two documents disagree on a decision rather than a detail, and
the code settles it:

- `/catalog/drops` builds its season picker from
  `seasons.filter((s) => s.code !== "CONTINUITY")` (`drops/page.tsx:42`). Put vintage
  in the CONTINUITY-coded season and **the picker hides it** — the board still renders
  via a hand-typed `?season=CONTINUITY` (the page passes `seasonCode` straight
  through, `drops/page.tsx:16-20`), but nobody navigating the UI would find it. That
  gives away the single biggest piece of reuse this project gets for free, and the
  drop-shaped workflow is the whole point.
- A separate season coded `VINTAGE` appears in that picker immediately.
- `classify` keys on the season **code**, not `kind` (`seasonSortValue`), and
  `"VINTAGE"` parses to `null` exactly as `"CONTINUITY"` does — so a separate season
  is just as safe from origin classification.

**So: a separate `Season` coded `VINTAGE`.** One catch to fix with it — Collections
buckets by `kind`, not code (`inContinuity`, `collections.ts:79`), so a
`kind = CONTINUITY` vintage season falls into the "Continuity (legacy)" bucket
alongside the 2,740 Cin7 rows. Give vintage its own bucket in `collections.ts` at the
same time; it is a few lines, and without it the Collections view silently mixes
one-of-one garments into the legacy pool.

**Three SKU fields, all `@unique` — pin them deliberately.** `Style.styleSku`,
`Colorway.colorwaySku` and `Variant.variantSku` each carry a unique constraint. Use
the §7/§8 scheme so a re-entered item collides loudly rather than silently forking:
`styleSku` = `VN-ONLN-<nummer>`, `colorwaySku` = `<nummer>`, `variantSku` =
`VN-ONLN-<nummer>-OS`.

`MediaSource.EXTERNAL` is documented as "any other absolute URL"
(`schema.prisma:392`), which is exactly
`https://vintage.lividjeans.com/13644-2.jpg`. **No Blob upload, no image
migration** — the images stay where the photographer already puts them, and the
Shopify push accepts them as-is (§7, verified).

`Source` needs one new value, `VINTAGE`. That follows the existing precedent of
`20260819125005_add_cin7_import_source` exactly. After the migration, remember the
documented Turbopack gotcha: **restart `npm run dev`** or the running server keeps
the old enum and rejects the new value at runtime.

---

## 4. Ingest

Two inputs, neither of them the Google Sheet — the point is to stop double-entering.

**Images.** The folder is now served publicly at `https://vintage.lividjeans.com/`,
so discovery can be plain HTTPS probing of `<sku>.jpg`, `<sku>-2.jpg`, `<sku>-3.jpg`.
Note the host **returned `429` during a burst of ~25 rapid HEAD requests** — the
actual threshold was not measured, so batch politely, back off, and cache per SKU.

Alternatively list the folder over SFTP with `ssh2` in a Node route — one connection,
no rate limit, and it sees files that aren't referenced yet. This works on Vercel's
**Node** runtime, *not* Edge. Prefer this if the module ever needs to detect photos
for items not yet entered.

Naming convention, verified: `<sku>.jpg` primary, `<sku>-2.jpg`, `<sku>-3.jpg`.
Count varies per item (2 or 3) and is recorded nowhere — it must come from the
actual directory contents, never from a formula.

**Product data.** A new entry UI at `/catalog/vintage/drops/[n]` (§5), replacing the
sheet's `INPUT` tab.

---

## 5. Entry UI — the sheet's INPUT columns are the form spec

Port these fields (Norwegian labels are the photographer's; keep them):

| INPUT col | Field | Notes |
|---|---|---|
| A | Nummer | item number = `colorwaySku` |
| B | Tittel | product title |
| C | Beskrivelse | free copy, becomes the first `<p>` of the body |
| D | Kategori | → Shopify `Type`, Cin7 `Category` |
| E | Opprinnelig produkt | keys the `COST` lookup |
| F | Retail Opprinnelig | original retail |
| G | Pris nett | selling price → Shopify `Variant Price`, Cin7 `PriceTier1` |
| H, I | Chest Width, Front Length | tops |
| K, L, M | Waist, Front Rise, Inseam | trousers/jeans |
| J | Størrelse | tagged size |
| N | Approx size | standardized contemporary size; presence changes the body copy |
| O | Type mål | `1` = tops, else trousers/jeans — selects the body template |
| P | Tags | drop number |
| Q | Barcode | |
| R | BRAND | → Shopify tag |
| S, T, U | Imported?, Ready for import, RE-IMPORT? | workflow state → replace with real status |

Show the item's photos beside the form. Every field written here takes a
`FieldOwner` `MANUAL` lock so no automated pass can overwrite hand-written copy.

Validation the sheet cannot do, and which would have caught the September outage:
missing photo, missing base photo, photo with no matching row, missing measurements
for the declared `Type mål`, missing barcode, duplicate SKU, and an image URL that
does not return `200` + `image/*`.

---

## 6. Pipeline isolation — the "without breaking anything" core

The four passes run `sync → enrich → normalize → classify`. Vintage products are
one-of-one: no season lineage, no carry-over, no Threadflow twin.

**The original prescription — "each pass must filter `source != VINTAGE`" — was
wrong.** Reading the passes on 2026-09-07: two need no guard at all, one needs a
guard in a different place than proposed, and the real exposure is somewhere the
draft did not look.

| Pass | What it would actually do to vintage | Guard |
|---|---|---|
| `sync` (Threadflow) | nothing — vintage isn't in Threadflow | none needed |
| `enrich/shopify` | nothing, **by construction** | none — just don't opt in |
| `normalize` | won't rewrite vintage rows, but vintage **skews the vote** for everyone else | exclude `VINTAGE` from the *planning* query |
| `classify` | nothing — CONTINUITY entries are already skipped | none needed |
| `import/cin7` | can't see vintage rows; but §8 opens a **round-trip** back into it | pin the SKUs (§3) |

**`enrich/shopify` is an allowlist, not a denylist.** `loadColorwaysForEnrich`
selects `where: { source: { in: sources } }` with
`DEFAULT_ENRICH_SOURCES = ["CIN7_IMPORT", "THREADFLOW"]`
(`enrich-shopify.ts:113-119`). Vintage is excluded the moment the enum value exists,
with no code change — the guard is simply **never adding `VINTAGE` to that array**,
and a comment saying why. The draft's worry was otherwise well-founded: matching
really is SKU → barcode → cleaned name (`matchRec`, `enrich-shopify.ts:150-160`), and
`cleanNameKey` strips trailing size tokens and punctuation, so "Levi's 501" would
key to `levis501`. One mitigation the draft missed: names mapping to more than one
Shopify product are dropped as ambiguous (`nameAmbiguous`, lines 74-83). That helps
only when the collision is *inside Shopify*; a vintage row matching a single
mainline product would still match. Keeping vintage out of the allowlist is what
makes this moot.

**`normalize` is the one that actually needs work — and not where the draft said.**
Two separate things:

- *Rewriting* vintage rows: already prevented. `normalize` loads MANUAL-locked
  `(colorway, field)` pairs and excludes them from every `updateMany`
  (`normalize.ts:99-127`). §5's rule — every UI-written field takes a `FieldOwner`
  `MANUAL` lock — covers `vendor` and `productType` for free.
- *Vintage skewing the canonical choice for everyone else*: *not* prevented, and not
  considered in the draft. `planField` runs `groupBy` over **all** colorways with no
  source filter (`normalize.ts:32-35`), and the canonical spelling is the
  **most-frequent** existing form. A few hundred vintage rows carrying `Kategori`
  values in the photographer's casing would join that vote and could flip the
  canonical `productType` casing for the mainline catalogue. **The guard belongs on
  the planning query**, not on the update: exclude `source = VINTAGE` from
  `planField`'s `groupBy`. This is the single real code change §6 requires.

**`classify` needs no guard.** `computePlan` skips any entry whose season has no
`SS/FW` sort value — *"Only classify real (SS/FW) seasons; leave CONTINUITY entries
as-is"* (`classify.ts:93-96`). `seasonSortValue("VINTAGE")` returns `null`, so
vintage entries are excluded from `origin` classification automatically. The `isCore`
half is tag-driven (`CORE`/`Allseasons`), and none of the §7 vintage tags match, so
`isCore` stays `false`. MANUAL locks on `isCore`/`origin` are a second layer
(`classify.ts:51-52`).

**`import/cin7` — the draft worried about the wrong half of it.** The pass is
`src/lib/cin7/import.ts`.

The drop/restock reconciliation the draft feared is scoped to
`where: { source: "CIN7_IMPORT" }` in both preview and apply
(`cin7/import.ts:260-261` and `481-482`), so it cannot cancel a vintage entry. It is
also keyed to the entry in the `CONTINUITY`-**coded** season; §3 puts vintage in a
season coded `VINTAGE`, which is a second miss. No guard needed, and the "every
vintage SKU goes to zero stock forever" worry evaporates — nothing is watching them.

**The real exposure runs the other way, and the draft did not see it.** §8 pushes
vintage into Cin7. `TARGET_LOCATIONS` (`cin7/import.ts:13-20`) includes **`Past
Løkka`** alongside the Livid stores — so a vintage garment sitting in Cin7 with qty 1
at a target location is *in scope for import*, and would come back as a duplicate
`CIN7_IMPORT` colorway of a product the master already owns.

What stops it is SKU pinning, not source. The importer skips a group when its base
matches an existing `colorwaySku` **or `styleSku`**, or when any variant SKU is
already taken (`cin7/import.ts:240-247`, mirrored at `355-366`). A Cin7 SKU of
`VN-ONLN-<nummer>-OS` splits to base `VN-ONLN-<nummer>` — which is exactly §3's
`styleSku`, and its variant SKU is exactly §3's `variantSku`. **Two independent
checks catch it, but only if §3's SKU scheme is followed literally.** Get that wrong
and the §8 export quietly manufactures duplicates. Add a `NOSYNC` tag as belt and
braces (§8 already sends one), and put this case in the §9 dry-run.

---

## 7. Shopify push

The push was read on 2026-09-07 (`src/lib/master/push-shopify.ts`, loading through
`getColorwayForPublish` / `buildShopifyPreview` in `publish.ts`). The draft flagged
this as unverified and was right to: **reuse is only partial.** Two of the four
things vintage needs are already there; two are not, and one of the gaps is a design
decision rather than a patch.

**Verified present:**

- **`EXTERNAL` media works as assumed.** Media is gated on
  `isPublic = /^https?:\/\//i` (`push-shopify.ts:202`), so
  `https://vintage.lividjeans.com/13644.jpg` passes and uploads via `fileCreate`
  with `originalSource`. No Blob round-trip. Uploaded file GIDs are cached on
  `MediaAsset.shopifyMediaId`, so re-pushing does not duplicate files. Needs the
  `write_files` scope; if media fails the push degrades to a warning and continues —
  which for vintage means **a product can go live with no photo and only a warning**,
  the exact September failure mode. Treat a media warning on a vintage push as fatal.
- **Media order.** `getColorwayForPublish` loads `media: { orderBy: { position: "asc" } }`
  (`publish.ts:20`), so "base photo first" holds provided the base photo is written at
  `position` **0** — `createBlobMedia` assigns `(max ?? -1) + 1`, so the first asset
  on a colorway is 0, not 1 (`media.ts:36`). Non-unisex products route `GALLERY` → the Shopify media section
  (`push-shopify.ts:216`), which is what vintage wants.
- **Single-variant `OS`.** One `Size` option, one variant per master variant
  (`push-shopify.ts:188-195`). A lone `OS` variant is the degenerate case and fine.

**Verified absent — this is extension, not reuse:**

- **No inventory, no cost.** The variant payload sets exactly `optionValues`,
  `price`, `inventoryItem.sku` and `barcode`. There is **no inventory quantity, no
  `inventoryPolicy`, and no cost field** anywhere in the push. Vintage's `qty 1`,
  `deny` policy and `Cost per item` are all new work — and qty/policy are precisely
  what stop a one-of-one garment being oversold.
- **The readiness gate is mainline-shaped, and vintage will always trip it.**
  `shopifyMissing` (`readiness.ts:35-45`) requires description, image, tags **and
  swatch hex, care page, fit guide**. A one-of-one vintage garment has none of the
  last three and never will, so every vintage push needs `allowIncomplete` — which
  switches off the missing-image check too. **Decide this rather than inherit it:**
  add a vintage readiness profile (variants, price, description, ≥1 image, barcode)
  next to the existing one. Blanket `allowIncomplete` would disable the guard this
  whole project exists to provide.
- **`SeasonEntry.drop` is not pushed.** The string `drop` does not occur in
  `push-shopify.ts` at all. The `DROP<n>` tag has to be derived from the entry's
  `drop` value at push time — `"Drop 7"` → `DROP7`, i.e. strip the space and
  upper-case — or written into `Colorway.tags`. Tags merge additively with whatever a
  merchant added in Shopify admin (`PRODUCT_MERGE_QUERY`), so adding this is safe.
- **Price must be season-scoped.** The push emits a warning when it runs without a
  season code, because the price then isn't season-scoped. `Pris nett` therefore
  belongs in a `Price` row on the `VINTAGE` season (§3), not loose on the colorway.
  The route is reachable as-is: `POST /api/catalog/push/shopify/bulk` takes
  `seasonCode` as a free string and passes it straight to `bulkPushToShopify` — no
  `SeasonKind` filter, no REGULAR default — so season `VINTAGE` needs no route change.

Vintage adds a field mapping, taken verbatim from `1. EXPORT SHOPIFY`:

- `Handle` = `lower(<nummer> & "-Vintage")`
- `Title` = `<Tittel> (<Approx size> or <Størrelse>)`
- `Vendor` = `Vintage`; `Type` = `<Kategori>`
- `Tags` = `DROP<n>,rocket-hide,<BRAND>,hide`
- `Option1 Name` = `Size`; `Option1 Value` = `<Approx size>` else `<Størrelse>`
- `Variant SKU` = `VN-ONLN-<nummer>-OS`
- Inventory: tracker `Shopify`, qty `1`, policy `deny`, service `manual`
- `Variant Price` = `<Pris nett>`; `Cost per item` = `COST` lookup on
  `Opprinnelig produkt`, rounded, default `100`
- `Image Src` = all photos for the SKU, `position` ordered, base photo first
- `Status` = `active`; `Published` = `True`; `Gift Card` = `False`; weight unit `g`

**`Body (HTML)` has three variants selected by `Type mål`** — port these by reading
the `C2` formula, not from memory:

1. `Type mål = 1` (tops): copy + Chest width + Front Length, then the
   "Hot tip for buying vintage online" block.
2. `Type mål ≠ 1`, `Approx size` blank (trousers): copy + Waist + Front rise +
   Inseam Length, then the same "Hot tip" block.
3. `Type mål ≠ 1`, `Approx size` set (jeans): copy + Standardized contemporary size
   + Tagged size + Waist/Front rise/Inseam, then the longer vintage-Levi's sizing
   explainer.

These blocks are customer-facing copy that has been live for years. Port them as
data (templates), not as inline strings in a component.

---

## 8. Cin7

**There is no Cin7 push target today** — verified: `src/app/api/catalog/push/`
contains only `loom/route.ts` and `shopify/bulk/route.ts`. Two options:

1. **Interim: export the DEAR CSV from Origio.** A one-to-one port of
   `2. EXPORT DEAR` (~90 columns, mostly constants: `Type=Stock`,
   `CostingMethod=FIFO`, `Weight=500` gram, `HSCode=63090000`,
   `CountryOfOrigin=United Kingdom`, `AdditionalAttribute1=GB`,
   `AdditionalAttribute3=Used Vintage garment`, `SaleTaxRule=Tax on sales`,
   `Status=Active`, `Sellable=YES`). Variable fields: `ProductCode`
   (`VN-ONLN-<nummer>-OS`), `ProductFamilySKU` (`VN-ONLN-<nummer>`), `Name`,
   `Category`, `Barcode`, `PriceTier1`, `ProductFamilyOption1Value`,
   `CommaDelimitedTags` (`DROP<n>,Zoom,NOSYNC`), `Description`.
2. **Build `POST /api/catalog/push/cin7`.**

Recommend (1) first — same output the team already trusts, far smaller blast radius,
and it decouples the Cin7 work from the Shopify work. Either way, mind the
round-trip: whatever reaches Cin7 becomes a candidate for the Cin7 *importer* (§6),
so the `VN-ONLN-<nummer>` SKU scheme and the `NOSYNC` tag are load-bearing, not
cosmetic. Metafield export and
dropschedule follow the same pattern later; neither is on the critical path.

---

## 9. Cut-over: golden-file diff

Do not switch by decision. Switch by evidence.

Run one real drop through **both** systems. Generate the Matrixify CSV and the DEAR
CSV from Origio and from the sheet, and **diff them**. Only when a full drop diffs
clean does Origio push anything live. Then run one more drop in parallel before the
sheet is retired.

This is the only reliable way to replace a spreadsheet that has been correct for
four years: the sheet is the test oracle.

---

## 10. Order of work

Each step independently shippable, each with a dry-run.

1. **Migration + guards, together.** Add `VINTAGE` to `Source`, plus the `VINTAGE`
   season, the `normalize`/`planField` vote exclusion (§6), and the exclusion of
   vendor `Vintage` from the Shopify importer (§3) — in the *same* change. The second
   of those cannot wait: the `@unique` SKU constraints mean a stray vendor tick and a
   future vintage row fight over the same keys. Otherwise this step is **much smaller
   than the draft assumed** — enrich, classify and the Cin7 import need no code change
   at all, only a comment on `DEFAULT_ENRICH_SOURCES` saying why `VINTAGE` is
   deliberately absent. **No vintage
   rows may be created until the normalize guard is in**, since the vote is skewed by
   the rows' mere existence. Restart `npm run dev` after the migration (the Turbopack
   enum gotcha). Dry-run `normalize` before and after and diff the plan: with no
   vintage rows yet, an empty remap delta only proves the guard **didn't regress
   mainline**. Proving it *works* needs vintage rows — re-run the same diff at the end
   of step 3, once a drop's worth of rows exists, and confirm the plan is still
   unchanged.
2. **Read-only vintage view** — ingest images by SKU, list what's on the host, show
   thumbnails. No writes. Immediately useful as a QA tool even while the sheet runs.
   Point the **existing drop board** (`src/lib/master/drops.ts`) at season `VINTAGE`
   rather than building a new list; drop filtering, readiness counts and per-drop
   summaries come for free.
3. **Entry UI** (§5) with validation, writing `SeasonEntry.drop` and `MANUAL` locks.
4. **Matrixify CSV export** from Origio → golden-file diff against the sheet.
5. **DEAR CSV export** → golden-file diff.
6. **Shopify push extension** — vintage readiness profile, inventory qty/policy,
   cost per item, `DROP<n>` tag from `SeasonEntry.drop` (§7). Behind a feature flag,
   after both diffs are clean. This is the step the draft under-scoped as "reuse".
7. Retire the sheet.

---

## Appendix — related findings, not in scope

- 30 `#REF!` errors in the sheet's `INPUT` formulas.
- 116 `#N/A` cached in `COST` — this feeds `Cost per item`, so some products are
  falling back to the default `100`.
- `TODAY()` appears in 14,939 cells, forcing volatile recalculation on every edit.
  This is why the sheet is slow, and it is fixable independently.
