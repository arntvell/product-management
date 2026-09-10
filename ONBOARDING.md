# Onboarding — Livid Product Master

This app is being transformed from a **stateless Shopify metafield editor** into a
**product master / middleware for Livid**: ingest products from several source
systems → store them canonically in Postgres (**Style → Colorway → Variant**, with
per-season data) → enrich per channel → push out to **Shopify (→ Sitoo)** and
**Loom (B2B)**.

> Full design rationale: `docs/product-master-architecture.md`.

---

## 1. Branches & deploy model (read this first)

> **Updated 2026-09-07.** This section previously said the master work lived only on
> `phase-0-product-master` and must never be merged to `main`. **That merge has
> happened** — the text below replaces it.

| Branch | What it is | Deploys to |
|---|---|---|
| `main` | **Trunk.** The legacy "Metafield Manager" *and* the full product master, merged at `d557113` (2026-09-01) | **Production** (Vercel) |
| `phase-0-product-master` | Historical. Fully contained in `main`, 0 commits ahead — kept for reference, safe to delete | — |
| feature branches | Cut from `main`, merged back when ready (e.g. `vintage-drops`) | Vercel preview per branch |

- **Do your work on a branch cut from `main`**, and keep it rebased so the merge back
  is a fast-forward. `main` is the integration point now, not phase-0.
- `git merge-base --is-ancestor origin/phase-0-product-master origin/main` passes —
  that is the check, if you doubt the table.
- **Never `git push` without explicit intent.** Merging to `main` deploys production,
  so do that deliberately, not as a reflex at the end of a task.
- **The database does not branch.** There is one shared Neon Postgres (§2), so a
  migration run from any branch lands in the data production reads. Additive-only
  unless you have decided otherwise on purpose.

---

## 2. Setup on a new machine

```bash
git clone https://github.com/arntvell/product-management.git
cd product-management
npm install
npx prisma generate        # src/generated/prisma is gitignored — must regenerate
npm run dev
```

**`.env.local` is NOT in the repo** (gitignored). Recreate it with these keys
(move them via a password manager / `vercel env pull`, not chat/email):

- Postgres (Neon): `ORIGO_POSTGRES_PRISMA_URL` (pooled, runtime), `ORIGO_POSTGRES_URL_NON_POOLING` (direct, migrations/CLI), and the other `ORIGO_POSTGRES_*` / `ORIGO_PG*` vars
- Shopify: `SHOPIFY_STORE_URL`, `SHOPIFY_ACCESS_TOKEN` (scopes: `write_products`, `write_files`)
- Threadflow: `THREADFLOW_URL`, `THREADFLOW_API_KEY`
- Cin7 Core: `CIN7_ACCOUNT_ID`, `CIN7_API_KEY`
- Loom: `LOOM_URL` + **`LOOM_LOCAL_TOKEN` or `LOOM_TOKEN`** (local dev was set up
  with the first, the deployed environments with the second; the client accepts
  either — `src/lib/loom/client.ts:14`)
- Vercel Blob: `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`
- App auth: `APP_PASSWORD` — gates `/api/auth/login`; the app won't let you in without it

The Prisma **CLI** reads `ORIGO_POSTGRES_URL_NON_POOLING` (direct) via
`prisma.config.ts`; the **runtime** uses the pooled URL through a driver adapter
(`src/lib/db.ts`). `DATABASE_URL` appears only in generated-client comments — it is
not used.

**The database is shared** (one Neon Postgres). Both machines hit the same master
data, so you'll see your progress immediately — no migration needed just to sync
machines. Run `npx prisma migrate deploy` only if you pull new migrations.

**Gotcha:** after a schema change / `prisma generate`, **restart `npm run dev`** —
Turbopack bundles the Prisma client, so a running server keeps the old enum types
and will reject new enum values at runtime.

---

## 3. Data model (Prisma — `prisma/schema.prisma`)

- **Style → Colorway → Variant.** Colorway is "the product"; variants are sizes.
- **Season / SeasonEntry** — a colorway belongs to seasons via `SeasonEntry`
  (many-to-many). `Season.kind` = `REGULAR` (SS27, FW26…) or `CONTINUITY`
  (season-less / legacy pool). `Season.sortOrder` is chronological.
- **Lifecycle:** `Colorway.isCore` (permanent CORE line) + `SeasonEntry.origin`
  (`NEW` = origin season, `CARRYOVER` = pulled forward). See §5.
- **`SeasonEntry.drop`** — which delivery of a season a product belongs to
  ("Drop 1", "Drop 2"). Free text so merchandising can name waves without a
  migration; indexed `[seasonId, drop]`. A drop slices ONE season, so it lives on
  the entry, not the colorway.
- **`Colorway.archived`** — whole-channel archive, distinct from
  `SeasonEntry.cancelled` (dropped from one season).
- **Price** (season × colorway × currency × type MSRP/WHOLESALE), **MediaAsset**,
  **SeasonImage**, **ChannelPublication** (SHOPIFY/LOOM), **ChannelContent**
  (per-channel field overrides), **Manufacturer**, **Brand**, **BrandTemplate**.
- **FieldOwner** — records `MANUAL` locks so automated passes (sync, classify)
  never overwrite a human edit.
- **Source** enum: `THREADFLOW | MANUAL | SHOPIFY_IMPORT | CIN7_IMPORT`.
- **`SyncRun`** records every pass. Note the three-way split: `errors` is **real
  failures only**; informational notes (SKU renames, parked duplicates) go in
  `warnings`, and deliberately-unwritten items in `skipped`. Mixing them made healthy
  runs look broken. Rows from before the split still have notes in `errors`.

Data volume, **as counted 2026-08-25**: THREADFLOW ~661 (SS27 567, FW26 132, 36
overlap) + CIN7_IMPORT 2,740 ≈ 3,400 colorways. These predate the Cin7 re-model
(`bc8e807`, which regrouped Cin7 products as colorways under real parent styles) and
the colorway merges — **recount before trusting them.**

---

## 4. Sources

- **Threadflow** (`src/lib/threadflow/`) — Livid's PLM, the source for current
  seasons (SS27, FW26). *No earlier collections exist there — it's new software.*
  Note: Threadflow assigns **per-season colorway IDs**, so carry-overs are matched
  by `colorwaySku` across seasons (fixed).
- **Cin7 Core** (`src/lib/cin7/`) — legacy inventory system; the historical
  catalogue. Imported in-stock products (OnHand > 0 at 6 Livid locations) into the
  CONTINUITY season. Cin7 SKUs use a **different scheme** than Shopify for old
  products (`JP` vs `JPN`, `IMP-` prefixes) — matters for enrichment matching.
- **Shopify** (`src/lib/shopify/`) — both a push target *and* the source of the
  merchandising layer (tags, vendor, product-type) for enrichment.

---

## 5. The master pipeline (run in THIS order)

Each step is a re-runnable API endpoint with a `{ "dryRun": true }` mode. **Order
matters** — enrichment reintroduces casing (Shopify data is mixed-case and
"wins"), so `normalize` must run *after* `enrich`.

```
sync  →  enrich  →  normalize  →  classify
```

| Step | Endpoint | What it does |
|---|---|---|
| **Sync** | `POST /api/catalog/sync` `{seasonCode, mode:"full"\|"no-images"}` | Pull a Threadflow season into the master (idempotent). Survives TF SKU rotations and per-season duplicates; a SKU collision now skips one product instead of failing the run |
| **Import** | `POST /api/catalog/import/cin7` `{dryRun, brands?}` | Cin7 in-stock → CONTINUITY; marks dropped when out of stock. Skips any group whose base or variant SKU already exists — no fragment duplicates |
| **Import** | `POST /api/catalog/import/shopify` `{dryRun, filter?}` | Shopify → master, **vendor-scoped**. Never blanket-import: the Shopify catalogue also holds vintage and fit-guide entries. `…/remove` undoes an import by vendor |
| **Enrich** | `POST /api/catalog/enrich/shopify` `{dryRun}` | Match to Shopify by SKU → barcode → cleaned-name; copy tags/vendor/type (non-destructive; unions tags; skips MANUAL locks). Allowlisted to `CIN7_IMPORT` + `THREADFLOW` |
| **Normalize** | `POST /api/catalog/normalize` `{dryRun, fields?}` | Canonical casing for vendor/product-type (most-frequent form wins) |
| **Classify** | `POST /api/catalog/classify` `{dryRun}` | Set `isCore` (from CORE/Allseasons tags) + `SeasonEntry.origin` (NEW/CARRYOVER from season lineage). Only classifies real SS/FW seasons — CONTINUITY entries are left alone. Respects MANUAL locks |

**Independent passes** — not part of the ordered chain; run when needed:

| Pass | Endpoint | What it does |
|---|---|---|
| **Customs enrich** | `POST /api/catalog/enrich/cin7` `{dryRun, seasonCode?, vendors?, fields?}` | Fills the customs block (HS code, country, weight, fibre) from Cin7's `AdditionalAttribute*` slots, which the original import never read. Fills empty fields only |
| **Size labels** | `POST /api/catalog/normalize/size-labels` `{dryRun}` | Reconciles 2-D sizes across sources (TF sends `L32`, Cin7 sends `32`; legacy rows carry `W27/LL32`) |
| **Merge colorways** | `POST /api/catalog/colorways/merge` `{keepId, loseId, dryRun\|confirm}` | Merges two rows that are the same garment — happens when TF rotates a SKU, or a Cin7 import and a TF sync reach the same product from two directions |
| **Carry prices** | `POST /api/catalog/prices/carry-forward` `{seasonCode, dryRun?, includeCore?, vendors?}` | Copies prices into a season for carried-forward products, from the newest season where they're actually priced. Never overwrites |
| **Drops** | `POST /api/catalog/drops` `{entryIds\|handles, seasonCode, drop}` | Assign products to a drop, by selection or by pasted handle list |

**Manual override:** `POST /api/catalog/colorways/[id]/classify`
`{isCore?, seasonCode?, origin?}` — sets CORE / carry-over and records a MANUAL
lock so `classify` won't revert it. Upserts the season entry, so you can carry a
Continuity/older product *into* the current season even if it isn't in it yet.

> **TODO:** wrap the four ordered passes into a single "Refresh master" action so
> the order can't be gotten wrong. Still API-only — only the Shopify import has a UI.

---

## 6. Pushing out

- **Shopify:** `POST /api/catalog/colorways/[id]/push` and
  `POST /api/catalog/push/shopify/bulk`. Hardened: additive tags (never wipes
  merchant tags), readiness gate, season-scoped price, idempotent media, clears
  emptied metafields.
- **Loom:** `POST /api/catalog/push/loom` `{colorwayIds, seasonCode}`. Upsert by
  stable id; skips not-ready products with reasons; records `ChannelPublication`.
  Since the first write-up it also has: a **dry run**, a **preview before sending**,
  **job confirmation** (polls Loom and reports `unconfirmed` rather than claiming an
  unobserved success), an explicit `event_id`, `is_core` sent per season as a real
  field, and **withdrawal**: pass `archive` to withdraw named colorways, and a
  colorway archived in the master is withdrawn from Loom always
  (`src/lib/loom/push.ts:127`) — its `ChannelPublication` goes to `withdrawn`.
- **Cin7: there is no push target.** `src/app/api/catalog/push/` holds only `loom/`
  and `shopify/bulk/`. Anything bound for Cin7 leaves as a CSV today.
- Publishing shows **Core before sending**, and a failed push is **retryable**.

---

## 7. Key UI

- `/catalog` — landing (counts, sync/import panels).
- `/catalog/collections` — **browse by line**: Core / SS27 / FW26 / SS26 / FW25 /
  Continuity. Filters: **vendor**, **Sale** (a product is on-sale if it has a
  `SALE*` tag). **Inline editing** of Core and New/Carry-over per row.
- `/catalog/drops` — the **drop board**: a season's waves, per-drop readiness counts,
  assign by selection or pasted handles.
- `/catalog/fix` — the **Fix grid**: manual overrides for products blocked from
  publishing. Filter by product type; edited rows stay listed; never shows a value
  that did not save.
- `/catalog/edit` — bulk grid editor, filterable **by drop and by carry-over**.
- `/catalog/publishing` — channel targeting + push.
- `/catalog/styles`, `/catalog/styles/[id]`, `/catalog/colorways/[id]`,
  `/catalog/colorways/[id]/media`, `/catalog/products/new`.
- `/` (root) — the **legacy** live-Shopify metafield editor. Now on `main` alongside
  the master (§1), not a separate branch.

---

## 8. Conventions & workflow

- **Verify before trusting.** Every data operation has a dry-run; run it first.
  Long ops run server-side even if a request times out — check the `SyncRun` table
  or the DB directly.
- **Non-destructive by default.** Imports/enrich/sync never delete on absence and
  never overwrite MANUAL-locked fields; they mark lifecycle state instead.
- **Commit after each working change**; push your branch to sync machines
  (`git push` / `git pull`, upstream is set). Merging to `main` deploys production —
  do it deliberately (§1).
- Typecheck with `npx tsc --noEmit` (ignore the stale `.next/types/validator.ts`
  noise); build with `npm run build`.

---

## 9. Open work / roadmap

- [ ] Run the full **SS27 Loom push** (~434 ready) at scale. *(Status unconfirmed —
      an FW26 push was corrected in `67f1522`; check `ChannelPublication` / `SyncRun`
      before assuming either way.)*
- [ ] Single **"Refresh master"** action (sync → enrich → normalize → classify).
- [ ] **Content-layer enrichment** — pull Shopify `custom.*` descriptions,
      reference metafields, and image galleries (we only pulled tags/vendor/type).
- [ ] **UI buttons** for enrich / normalize / classify (still API-only; the Shopify
      import has a panel).
- [ ] The ~105 **unmatched Livid Continuity** products (not in Shopify or named too
      differently) — manual or heuristic classification if wanted.
- [ ] Live-test **Shopify media idempotency** with a public-media product.
- [x] ~~Poll **Loom job status**~~ — done; the push polls and reports `unconfirmed`
      rather than claiming an unobserved success.
- [ ] Add a monotonic `version` for the Loom outbox.
- [ ] **Vintage drops** — fold the vintage Google-Sheet workflow into the master.
      Design and open questions: `docs/vintage-drops-integration.md` (proposal, on
      branch `vintage-drops`, nothing implemented).
- [ ] Correct `ONBOARDING`'s data counts (§3) after a fresh recount.
- [ ] Phase 7 — retire the legacy live-Shopify plumbing once the master is at parity.

---

*Deploy model, secrets handling, and per-feature detail also live in the
architecture doc and the git history. When in doubt, dry-run and read the DB.*
