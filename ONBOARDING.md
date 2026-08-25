# Onboarding — Livid Product Master

This app is being transformed from a **stateless Shopify metafield editor** into a
**product master / middleware for Livid**: ingest products from several source
systems → store them canonically in Postgres (**Style → Colorway → Variant**, with
per-season data) → enrich per channel → push out to **Shopify (→ Sitoo)** and
**Loom (B2B)**.

> Full design rationale: `docs/product-master-architecture.md`.

---

## 1. Branches & deploy model (read this first)

| Branch | What it is | Deploys to |
|---|---|---|
| `main` | The **original** legacy "Metafield Manager" (stateless live-Shopify editor) + a few shipped fixes | **Production** (Vercel) |
| `phase-0-product-master` | **All** the product-master work (this document's subject). ~60 commits | Not production |

- The master work lives **only** on `phase-0-product-master`. Do your work here.
- `main` is production. Only legacy-editor fixes go there, cherry-picked — never merge the master branch into `main` yet.
- **Never `git push` without explicit intent.** Pushing this branch is fine; pushing to `main` deploys production.

---

## 2. Setup on a new machine

```bash
git clone https://github.com/arntvell/product-management.git
cd product-management
git checkout phase-0-product-master
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
- Loom: `LOOM_LOCAL_TOKEN`, `LOOM_URL`
- Vercel Blob: `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`

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
- **Price** (season × colorway × currency × type MSRP/WHOLESALE), **MediaAsset**,
  **SeasonImage**, **ChannelPublication** (SHOPIFY/LOOM), **ChannelContent**
  (per-channel field overrides), **Manufacturer**, **Brand**, **BrandTemplate**.
- **FieldOwner** — records `MANUAL` locks so automated passes (sync, classify)
  never overwrite a human edit.
- **Source** enum: `THREADFLOW | MANUAL | SHOPIFY_IMPORT | CIN7_IMPORT`.

Current data (approx): **THREADFLOW ~661** (SS27 567, FW26 132, 36 overlap) +
**CIN7_IMPORT 2,740** = ~3,400 colorways.

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
| **Sync** | `POST /api/catalog/sync` `{seasonCode, mode:"full"\|"no-images"}` | Pull a Threadflow season into the master (idempotent) |
| **Import** | `POST /api/catalog/import/cin7` `{dryRun, brands?}` | Cin7 in-stock → CONTINUITY; marks dropped when out of stock |
| **Enrich** | `POST /api/catalog/enrich/shopify` `{dryRun}` | Match to Shopify by SKU → barcode → cleaned-name; copy tags/vendor/type (non-destructive; unions tags; skips MANUAL locks) |
| **Normalize** | `POST /api/catalog/normalize` `{dryRun, fields?}` | Canonical casing for vendor/product-type (most-frequent form wins) |
| **Classify** | `POST /api/catalog/classify` `{dryRun}` | Set `isCore` (from CORE/Allseasons tags) + `SeasonEntry.origin` (NEW/CARRYOVER from season lineage). Respects MANUAL locks |

**Manual override:** `POST /api/catalog/colorways/[id]/classify`
`{isCore?, seasonCode?, origin?}` — sets CORE / carry-over and records a MANUAL
lock so `classify` won't revert it. Upserts the season entry, so you can carry a
Continuity/older product *into* the current season even if it isn't in it yet.

> **TODO:** wrap these four into a single "Refresh master" action so the order
> can't be gotten wrong.

---

## 6. Pushing out

- **Shopify:** `POST /api/catalog/colorways/[id]/push` and
  `POST /api/catalog/push/shopify/bulk`. Hardened: additive tags (never wipes
  merchant tags), readiness gate, season-scoped price, idempotent media, clears
  emptied metafields.
- **Loom:** `POST /api/catalog/push/loom` `{colorwayIds, seasonCode}`. Upsert by
  stable id; skips not-ready products with reasons; records `ChannelPublication`.
  The full **SS27 Loom push (~434 ready products)** is cleared but not yet run at
  scale.

---

## 7. Key UI

- `/catalog` — landing (counts, sync/import panels).
- `/catalog/collections` — **browse by line**: Core / SS27 / FW26 / SS26 / FW25 /
  Continuity. Filters: **vendor**, **Sale** (a product is on-sale if it has a
  `SALE*` tag). **Inline editing** of Core and New/Carry-over per row.
- `/catalog/edit` — bulk grid editor. `/catalog/publishing` — channel targeting +
  push. `/catalog/styles`, `/catalog/colorways/[id]`.
- `/` (root) — the **legacy** live-Shopify metafield editor (also on `main`).

---

## 8. Conventions & workflow

- **Verify before trusting.** Every data operation has a dry-run; run it first.
  Long ops run server-side even if a request times out — check the `SyncRun` table
  or the DB directly.
- **Non-destructive by default.** Imports/enrich/sync never delete on absence and
  never overwrite MANUAL-locked fields; they mark lifecycle state instead.
- **Commit after each working change**; push this branch to sync machines
  (`git push` / `git pull`, upstream is set). Don't push to `main`.
- Typecheck with `npx tsc --noEmit` (ignore the stale `.next/types/validator.ts`
  noise); build with `npm run build`.

---

## 9. Open work / roadmap

- [ ] Run the full **SS27 Loom push** (~434 ready) at scale.
- [ ] Single **"Refresh master"** action (sync → enrich → normalize → classify).
- [ ] **Content-layer enrichment** — pull Shopify `custom.*` descriptions,
      reference metafields, and image galleries (we only pulled tags/vendor/type).
- [ ] **UI buttons** for import / enrich / normalize / classify (currently API-only).
- [ ] The ~105 **unmatched Livid Continuity** products (not in Shopify or named too
      differently) — manual or heuristic classification if wanted.
- [ ] Live-test **Shopify media idempotency** with a public-media product.
- [ ] Poll **Loom job status**; add a monotonic `version` for the outbox.
- [ ] Phase 7 — retire the legacy live-Shopify plumbing once the master is at parity.

---

*Deploy model, secrets handling, and per-feature detail also live in the
architecture doc and the git history. When in doubt, dry-run and read the DB.*
