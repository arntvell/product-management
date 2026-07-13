# Product Master — architecture & phased plan

**Status:** proposal for review (no code yet)
**Author:** drafted with Claude, 2026-07-13
**Audience:** the team building the new "product master" out of the current *Metafield Manager* app.

> **One paragraph.** Today this app (`product-management`, internally "Metafield Manager") is a **stateless Shopify editor** — it reads products live from the Shopify Admin API, lets you edit `custom.*` metafields / prices / media in a table, and writes straight back. It has **no database and no product model of its own**. This document describes turning it into the **product master**: the single source of truth for all product data — Livid products pulled from **Threadflow**, plus manually-created **external-brand** products — that decides, per product, which channels it publishes to (**Shopify → Sitoo**, **Loom** B2B) and pushes data outward. It is the middleware side of the companion Loom handoff (`handoff.md`) and consumes the Threadflow External Read-Only API.

---

## 0. TL;DR

1. Add a **Postgres + Prisma** persistence layer — the app has none today. This is the foundational change everything else depends on.
2. Model products as **Style → Colorway → Variant**, with **per-season** data (prices, size availability, images, dropped/approved) and a **global customs block** + manufacturer + brand. This mirrors Loom's model so the feed maps cleanly.
3. **Ingest** from Threadflow (`GET /api/external/v1/products?seasonId=…` + `/manufacturers`) on a **daily schedule + manual trigger**, with modes (full / prices-only / with-or-without images).
4. Support **manual creation** of external-brand products (no Threadflow source).
5. Track **three independent lifecycle axes** (per handoff §6): per-channel **publish state**, per-season **cancelled/dropped**, **archived**. Missing-from-feed is never a delete.
6. **Publish** per product to Shopify and/or Loom; reuse the existing Shopify mutations for the Shopify push; build the Loom feed per `handoff.md`.
7. **Coexist**: the current live-Shopify screens stay running untouched; the master is built alongside under a new nav section, sharing UI components and the Shopify client.
8. Accept the **one write-back**: per-variant weighted-average cost from Loom → store → forward to Shopify.

---

## Build progress (updated 2026-07-13)

Built on branch `phase-0-product-master` (local commits, not pushed). SS27 synced: 171 styles / 532 colorways / 4,451 variants.

- ✅ **Phase 0 — Foundations.** Postgres + Prisma 7 (Vercel Postgres/Neon, driver adapter), full schema, migrations, Catalog shell.
- ✅ **Phase 1 — Threadflow ingestion.** Typed client, bulk idempotent sync (barcode set-once, don't-clobber customs, dropped→cancelled, all currencies, images), manual trigger, browse + season filter, image proxy.
- ✅ **Phase 2 — Enrichment & external products.**
  - Colorway editor: product props + all `custom.*` metafields, **channel-split content** (Base / Shopify / Loom) incl. **tags**, **field ownership** (sync-respecting), vendor/product-type mapped from Threadflow.
  - **Bulk grid editor** (virtualized, fill-down, channel-layer toggle, batch save).
  - **Brand-template product builder** (multi-product, reusable per-brand defaults for external brands).
  - **Shopify carry-over importer** (vendor-scoped, dry-run preview, archived + sold-out-sale exclusions, per-product & per-vendor removal).
  - **Media manager** on Vercel Blob (upload, drag-reorder, delete, adopt-external-to-Blob); full gallery on import.
- 🚧 **Phase 3 — Channels + Shopify push (in progress).** Channel targeting (`ChannelPublication`), Publishing overview, and **Shopify dry-run preview** are built. **The live Shopify write is intentionally not wired yet** — to be done together.
- ⬜ **Phase 4 — Loom push**, **Phase 5 — Pricing & cost write-back**, **Phase 6 — Scheduling**, **Phase 7 — retire live-Shopify plumbing.**

**Known follow-ups:** reference pickers (care/fitguide/collection/model — deferred, staying Shopify-GID-based); Livid HS-code/customs-description/weight are empty from Threadflow (source-side Customs Defaults gap); mixed row-id scheme (cuid vs uuid, harmless); `SeasonImage`↔`MediaAsset` not yet unified.

---

## 1. Guiding principles

- **The master owns the truth.** Once a product lives in the master, the master decides what every channel sees. Channels are push targets, not editors.
- **Explicit lifecycle, never inference.** A product vanishing from a Threadflow page does **not** delete it. Removal is an explicit archive/cancel signal (mirrors the rule Loom enforces).
- **Stable internal IDs.** The master mints its own immutable id per Style/Colorway/Variant and *also* stores the source system's ids (Threadflow ids, Shopify GIDs, Loom keys). Matching is always on stable ids/natural keys, never on renameable display strings.
- **Field ownership is explicit.** Every field is owned by exactly one source at a time (Threadflow, Shopify-import, or manually-authored-in-master). Syncs must not clobber manager-authored data. See §5.3.
- **Idempotent, at-least-once sync.** Re-running a sync or re-delivering a push is always safe.
- **Non-destructive coexistence.** Nothing in this plan changes or risks the existing Shopify editor until we deliberately migrate it.

---

## 2. Where this sits (topology)

```
                      ┌──────────────────────────────────────────┐
  Threadflow  ──pull──▶│           product-management             │──push──▶  Shopify ──▶ Sitoo
  (Livid only,         │            (PRODUCT MASTER)              │           (reuse existing
   read-only API,      │                                          │            Shopify client)
   season-scoped)      │  Postgres + Prisma                       │
                       │  Style → Colorway → Variant              │──push──▶  Loom (B2B)
  Shopify carry-over ─▶│  + Season data + Channels + Lifecycle    │◀─────────  per-variant
  (import external)    │  + Customs + Manufacturer + Prices       │  writeback  avg cost
                       │                                          │
  Manual create ──────▶│  ── existing live-Shopify editor ──      │  (kept side-by-side,
  (external brands)    │     (/ , /groups, /models, /media)       │   untouched for now)
                       └──────────────────────────────────────────┘
```

---

## 3. Coexistence strategy (side-by-side)

We keep the current app fully functional and build the master next to it.

> **The editor is core, not legacy.** The rich editing today's app provides is not something we retire — it *is* the master's enrichment layer, reborn on top of a real data model. The only thing that changes underneath is the plumbing: instead of writing live to Shopify, every edit lands on the master record and the master pushes it outward. So all of these remain first-class in the new Catalog, editing **master data**:
>
> - **Product properties** — tags, status, vendor/brand, product type.
> - **All ~17 `custom.*` metafields** — descriptions, details, taglines, style name, `color_hex`, and the reference metafields (`same_product`, `style_with`, `care_page`, `fitguide`, `model_info`, recommended collection, unisex style-with, men/women images).
> - **Media** — upload, gallery, drag-to-reorder, per-slot assignment.
> - **Prices** — variant price / compare-at, extended to season scope (§9).
> - **Power tools** — inline cell editing, find & replace, column picker, the care/fitguide/collection/model **pickers**, **group auto-linking** (`same_product`), and **fit models** (metaobjects).
> - **Split by channel** — descriptive fields can hold **different values for Shopify (B2C) and Loom (B2B)** — the wholesale customer reads different copy than the retail shopper. See §4.3.
>
> These are carried into the master with the same UI components; what they write changes, not what they do.

| Area | Current (keep running) | New (build) |
|---|---|---|
| Nav | Products / Groups / Models / Media (live Shopify) | New section, e.g. **Catalog** → Seasons, Styles, Colorways, Sync, Publishing, External products |
| Data | Live reads from Shopify, no store | Postgres via Prisma |
| Shopify client | `src/lib/shopify/*` | **Reused** for the Shopify *push* target |
| Editing UI | `product-table`, `tags-cell`, media grid/upload, metafield editors, pickers, find & replace, groups, models | **Carried into the master** — same components, now editing master records instead of Shopify directly |
| Types | `src/types/index.ts` (Shopify-shaped) | New `Style`/`Colorway`/`Variant`/`Season` types generated by Prisma + view models |

No existing route, hook, or component is modified in the early phases. The master lives under new routes (`/catalog/*`) and new libs (`src/lib/master/*`, `src/lib/threadflow/*`, `src/lib/loom/*`). The old live-Shopify pages keep running until the master's editing surfaces reach parity — then we retire the *live-Shopify plumbing* (not the functionality, which already lives in the master by then). See Phase 7.

---

## 4. Data model

Business vocabulary (aligned with Loom's, per handoff §1):

- **Style** — the garment (parent). e.g. "Beth".
- **Colorway** — one colour of a style. **This is the master "product" record.**
- **Variant** — the sellable size unit (SKU + barcode).
- **Season** — selling season; prices, sizes, images, dropped flag are scoped to it.
- **Brand** — Livid or external.
- **Manufacturer** — factory with address; used for Loom customs invoices.

### 4.1 Prisma schema sketch

```prisma
// Illustrative — field names/types to be finalised in Phase 0.

model Brand {
  id          String   @id @default(cuid())
  name        String   @unique          // "Livid", external brand names
  isLivid     Boolean  @default(false)
  gender      String?                    // default gender for the brand's styles
  styles      Style[]
  colorways   Colorway[]
}

model Manufacturer {
  id           String  @id              // = Threadflow manufacturer_id (stable external PK)
  name         String
  addrLine1    String?
  addrLine2    String?
  zip          String?
  city         String?
  country      String?
  colorways    Colorway[]
}

model Season {
  id             String   @id @default(cuid())
  code           String   @unique       // "SS27", "FW26"
  name           String?
  threadflowId   String?  @unique        // maps to TF seasonId
  kind           SeasonKind @default(REGULAR)  // REGULAR | CONTINUITY (carry-over / season-less)
  sortOrder      Int      @default(0)
  entries        SeasonEntry[]
  prices         Price[]
  seasonImages   SeasonImage[]
}

model Style {
  id             String   @id @default(cuid())
  source         Source                   // THREADFLOW | MANUAL | SHOPIFY_IMPORT
  threadflowId   String?  @unique
  styleSku       String   @unique
  styleName      String
  gender         String?
  unisex         Boolean  @default(false)
  category       String   @default("Uncategorized")
  brandId        String?
  brand          Brand?   @relation(fields: [brandId], references: [id])
  // Customs block (Threadflow exposes these at style level, resolved from its
  // Customs Defaults by brand+category). Loom wants them per colorway — we store
  // the default here and allow a per-colorway override (§4.2).
  hsCode             String?
  customsDescription String?
  weightKg           Decimal? @db.Decimal(8,3)   // store kg; see §11 unit note
  fiberComposition   String?
  colorways      Colorway[]
  fieldOwners    FieldOwner[]             // see §5.3
}

model Colorway {                          // = the master "product"
  id             String   @id @default(cuid())
  source         Source
  threadflowId   String?  @unique
  colorwaySku    String   @unique
  name           String
  color          String?
  swatchHex      String?
  swatchImageUrl String?
  productType    String?
  styleId        String
  style          Style    @relation(fields: [styleId], references: [id])
  brandId        String?                  // Loom wants brand per product (external brands)
  brand          Brand?   @relation(fields: [brandId], references: [id])
  manufacturerId String?
  manufacturer   Manufacturer? @relation(fields: [manufacturerId], references: [id])
  countryOfOrigin String?
  // ---- Product properties (carried over from today's editor) ----
  status         ProductStatus @default(DRAFT) // ACTIVE | DRAFT | ARCHIVED (Shopify-facing)
  tags           String[]
  vendor         String?
  // ---- Optional customs overrides (else inherit from Style) ----
  hsCodeOverride             String?
  customsDescriptionOverride String?
  weightKgOverride           Decimal? @db.Decimal(8,3)
  fiberCompositionOverride   String?
  // ---- Enrichment: the full custom.* metafield set, authored in the master ----
  //  Free text:
  shortDescription String?
  fullDescription  String?
  details          String?
  styleTagline     String?
  styleName        String?
  //  Reference metafields (store target GIDs / ids; edited via the pickers):
  sameProduct              String[]   // list.product_reference — group auto-link
  styleWith                String[]   // list.product_reference
  styleWithUnisexHerre     String[]   // list.product_reference
  styleWithUnisexDame      String[]   // list.product_reference
  carePageId               String?    // page_reference (care picker)
  fitguidePageId           String?    // page_reference (fitguide picker)
  recommendedCollectionId  String?    // collection_reference
  modelInfoId              String?    // metaobject_reference (fit model)
  flatFileId               String?    // file_reference (flat-lay)
  menImages                String[]   // list.file_reference (unisex)
  womenImages              String[]   // list.file_reference (unisex)
  // ---- Media (full gallery, upload + reorder) ----
  media          MediaAsset[]         // see MediaAsset model below
  // ---- channel + lifecycle + relations ----
  variants       Variant[]
  entries        SeasonEntry[]
  prices         Price[]
  publications   ChannelPublication[]
  seasonImages   SeasonImage[]
  fieldOwners    FieldOwner[]
  archived       Boolean  @default(false)  // whole-channel archive (handoff §6.3)
}

model MediaAsset {                        // the product gallery (upload + drag-reorder)
  id            String   @id @default(cuid())
  colorwayId    String
  colorway      Colorway @relation(fields: [colorwayId], references: [id])
  url           String                     // object-storage URL after upload
  alt           String?
  mediaType     String   @default("IMAGE") // IMAGE | VIDEO | MODEL_3D
  position      Int                         // sort order for reorder
  shopifyMediaId String?                    // GID once pushed to Shopify
}

model Variant {
  id            String  @id @default(cuid())  // stable master id (TF has none — we mint it)
  colorwayId    String
  colorway      Colorway @relation(fields: [colorwayId], references: [id])
  variantSku    String   @unique
  barcode       String?                   // set once, never blanked (§5.2)
  // one- or two-dimensional size:
  sizeLabel     String                    // "M" or "W32/L32"
  dim1          String                    // "M" or waist "32"
  dim2          String?                   // length "32" for 2-D
  averageCostNok Decimal? @db.Decimal(14,2) // written back from Loom (§9)
  seasonLinks   SeasonVariant[]
}

model SeasonEntry {                       // colorway × season
  id            String   @id @default(cuid())
  colorwayId    String
  seasonId      String
  colorway      Colorway @relation(fields: [colorwayId], references: [id])
  season        Season   @relation(fields: [seasonId], references: [id])
  cancelled     Boolean  @default(false)  // = Threadflow "dropped" (handoff §6.2)
  approvedForProduction Boolean @default(false)
  merchPosition Int?                       // preserved across cancel/restore
  @@unique([colorwayId, seasonId])
}

model SeasonVariant {                     // which variants exist that season (additive)
  seasonEntryId String
  variantId     String
  @@id([seasonEntryId, variantId])
}

model Price {                             // unique per season × colorway × currency × type
  id          String   @id @default(cuid())
  seasonId    String
  colorwayId  String
  currency    String                      // "NOK" | "EUR" | "USD"
  priceType   PriceType                    // MSRP | WHOLESALE
  amount      Decimal  @db.Decimal(14,2)
  @@unique([seasonId, colorwayId, currency, priceType])
}

model SeasonImage {                       // colorway × season × slot
  id          String  @id @default(cuid())
  seasonId    String
  colorwayId  String
  slot        ImageSlot                    // MAIN | ALT
  url         String
  @@unique([seasonId, colorwayId, slot])
}

model ChannelPublication {                // per product per channel publish state (handoff §6.1)
  id          String   @id @default(cuid())
  colorwayId  String
  channel     Channel                      // SHOPIFY | LOOM
  published   Boolean  @default(false)
  externalId  String?                       // Shopify product GID / Loom key once pushed
  lastPushedAt DateTime?
  lastPushStatus String?
  @@unique([colorwayId, channel])
}

model FieldOwner {                        // §5.3 — who owns each field, so sync won't clobber
  id          String  @id @default(cuid())
  entityType  String                       // "style" | "colorway"
  entityId    String
  field       String
  owner       Source                        // THREADFLOW | MANUAL | SHOPIFY_IMPORT
  lockedAt    DateTime?
}

model SyncRun {                           // audit + reconciliation
  id          String   @id @default(cuid())
  source      String                       // "threadflow" | "shopify-import" | "loom-cost"
  mode        String                       // "full" | "prices-only" | "no-images" | ...
  seasonCode  String?
  startedAt   DateTime
  finishedAt  DateTime?
  status      String                       // "running" | "ok" | "partial" | "failed"
  counts      Json?                         // {created, updated, skipped, errored}
  errors      Json?
}

model ChannelContent {                    // §4.3 — per-channel override of a splittable field
  id          String  @id @default(cuid())
  colorwayId  String
  channel     Channel                      // SHOPIFY (B2C) | LOOM (B2B)
  field       String                       // e.g. "fullDescription", "styleWith", "tags"
  value       String                       // scalar, or JSON-encoded list for list fields
  @@unique([colorwayId, channel, field])
}

enum Source        { THREADFLOW MANUAL SHOPIFY_IMPORT }
enum SeasonKind    { REGULAR CONTINUITY }
enum PriceType     { MSRP WHOLESALE }
enum ImageSlot     { MAIN ALT }
enum Channel       { SHOPIFY LOOM }
enum ProductStatus { ACTIVE DRAFT ARCHIVED }
```

### 4.2 Notes on the model

- **The editor's fields all have a home.** Everything editable in today's app maps onto the master: product props (`status`, `tags`, `vendor`), the full `custom.*` metafield set (free-text + reference fields, edited via the same pickers), and the full media gallery (`MediaAsset`, with upload + reorder). These are **master-authored** (`MANUAL` owner, §5.3) and pushed to Shopify — the reference metafields and media map straight onto the existing Shopify mutations (§7.1).
- **Reference metafields store target ids.** `sameProduct`, `styleWith`, `care_page`, etc. hold Shopify GIDs / master ids (as today). The **Groups** auto-linker still populates `sameProduct`; the **Models** editor still manages the fit-model metaobjects behind `modelInfoId`. Note these currently point at Shopify pages/collections/files — see §11 for whether those references also need master-native equivalents once Shopify becomes a pure push target.
- **Customs placement.** Threadflow returns customs (`hs_code`, `customs_description`, `weight`, `fiber_composition`) at **style** level; Loom wants them at **colorway** level. We store the style-level value and expose a per-colorway override that falls back to the style. When building the Loom feed we resolve override → style.
- **Threadflow has no stable `variant_id`.** Its `/products` variants carry only `sku`, `barcode`, `dimensions`. So the master **mints** the stable variant id and matches incoming variants on `variantSku` within a colorway. Style/colorway *do* have TF ids — we key on those. (Open question §11.2.)
- **Weight unit:** the current `/products` doc says `weight` is a decimal string in **kilograms** (the older ThreadFlow feed used grams; new one is kg). We store kg. Confirm at integration time.
- **CONTINUITY season** models carry-over / external non-seasonal products, so everything still lives in "a season" (Loom needs season context) without forcing a wrong real season. (Handoff §11.4.)

### 4.3 Channel-split content (B2B vs B2C)

The copy a **B2B** buyer reads in Loom is not the copy a **B2C** shopper reads in Shopify/Sitoo. So editable content is not one value fanned out identically — it is a **base value plus per-channel overrides**.

- **Shared, single-valued (never split):** identity/SKUs, barcode, customs block, manufacturer, weight, country of origin. Same everywhere by definition.
- **Channel-splittable:** the marketing/merchandising fields — `shortDescription`, `fullDescription`, `details`, `styleTagline`, `styleName`, `tags`, `productType`, `styleWith` / recommendations, and **media selection/order**. (The exact set is confirmable — §11.11.)
- **Pricing is already split by nature:** wholesale → Loom, MSRP/retail → Shopify. Handled by the `PriceType` model (§9), not by `ChannelContent`.

**Resolution.** The effective value for a `(colorway, channel, field)` is: **`ChannelContent` override if present → else the base column** on `Colorway`. A field with no override inherits the base, so you only author a channel-specific version when it actually differs.

**Editor UX.** A channel-splittable field renders a base value plus a **Shopify / Loom** switch (or side-by-side columns) with an *"inherit from base"* default; overriding one channel never touches the other. The publish step (§7) sends each channel its **resolved** value. Overrides are always `MANUAL`-owned (§5.3), so a Threadflow sync updates the base but never silently rewrites a channel override.

---

## 5. Ingestion — Threadflow → master

### 5.1 Endpoints used

| Purpose | Threadflow endpoint |
|---|---|
| Full nested catalog for a season | `GET /api/external/v1/products?seasonId=…` (paginated at **style** level) |
| Manufacturer master (name + address) | `GET /api/external/v1/manufacturers` and `/manufacturers/:id` |
| Images | image refs returned in `/products`, fetched via `/api/external/v1/images/<path>` with the same API key |

Auth: static API key via `X-API-Key` header (env `THREADFLOW_API_KEY`, base `THREADFLOW_URL`).

To capture SS27 fully — including not-yet-approved and dropped colorways — sync with `includeUnapproved=true&includeDropped=true`, and record the `dropped` / `approved_for_production` flags into `SeasonEntry` (they change each sync).

### 5.2 Upsert rules

- **Match** Style on `threadflowId`, Colorway on `threadflowId`, Variant on `variantSku` (within colorway). Create-or-update; never delete on absence.
- **Barcode set-once:** if incoming barcode is empty and we already have one, keep the existing (SS27 barcodes are blank until production).
- **Customs "don't clobber with empty":** never overwrite a populated customs field with a blank incoming value.
- **Prices:** upsert `(season, colorway, currency, type)` rows from the `prices` object (`msrp`, `ws`). Livid prices are TF-owned (calc lives in Threadflow).
- **Images:** in image-included modes, fetch bytes via the proxy and re-host (see §7 for the Loom side); store per-season `MAIN`/`ALT`.
- **Manufacturer:** resolve `manufacturer_id`, upsert the `Manufacturer` record from `/manufacturers/:id`.

### 5.3 Field ownership / locking (critical)

The brief says text will *eventually* be authored in the manager, but for now TF text may be imported for SS27. To let both coexist without a sync wiping manual edits:

- Each syncable field on Style/Colorway has an **owner** (`FieldOwner`). Default owner for TF-sourced products = `THREADFLOW`.
- When a user edits a field in the manager, its owner flips to `MANUAL` (locked).
- A Threadflow sync **only writes fields it owns**. Manager-owned fields are skipped.
- A per-field / per-product "revert to Threadflow" action re-hands ownership to TF and re-pulls.

### 5.4 Sync modes

Selectable per run (and per schedule): `full` · `no-images` · `prices-only` · `single-season` · `single-style`. Each recorded in `SyncRun` with counts and errors; one bad style never blocks the batch.

### 5.5 Shopify carry-over import (secondary ingestion)

Carry-over and external products that already exist in Shopify need to reach Loom. A one-time/importer path reads existing Shopify products (reusing the current Shopify client) and creates master Colorways with `source = SHOPIFY_IMPORT`, `brand` set from Shopify vendor, into a `CONTINUITY` season. These then require the customs block filled before they can publish to Loom.

---

## 6. External product creation (manual)

- Create Style → Colorway → Variant by hand for external brands (`source = MANUAL`).
- A **channel-target dialog** on create/edit: choose Shopify and/or Loom (some products are B2B-only).
- **Input fields differ by destination.** The form is grouped: *master fields* (brand, category, gender, customs, manufacturer) → required for Loom; *Shopify-facing enrichment* (descriptions, taglines, media) → required for Shopify. The form validates the required set for each selected channel before publish is allowed.
- Manufacturers can be created/edited here too (needed for Loom customs on external goods).

---

## 7. Publishing — master → channels

Per-colorway `ChannelPublication` rows drive everything. A product is pushed to a channel only when `published = true` for it. Each channel receives the **resolved** content for that channel — the `ChannelContent` override where one exists, otherwise the base value (§4.3) — so Shopify gets the B2C copy and Loom gets the B2B copy from the same record.

### 7.1 Shopify (→ Sitoo)

- Map master fields → Shopify product + `custom.*` metafields, **reusing** `src/lib/shopify/mutations.ts` (`PRODUCT_UPDATE_MUTATION`, `METAFIELDS_SET_MUTATION`, variant/price mutations, media mutations).
- Store the resulting Shopify product GID in `ChannelPublication.externalId`.
- Sitoo is downstream of Shopify (no direct integration needed here).

### 7.2 Loom (B2B)

- Build the Loom feed payload exactly per `handoff.md`: stable ids at every level, `brand` per product, `channels` object, per-season `cancelled`/`approved_for_production`, `prices` as `(currency × {msrp, ws})`, full customs block, `manufacturer_id`, variants with `barcode` + `dimensions`, and the 2-D SKU suffix rule (`waist+length` digits, no `W`/`L`).
- **Delivery mechanism is an open question** (handoff §9.1 / §11.1): webhook push vs Loom pull, envelope, auth, batching, versioning. Design the payload now; wire transport once agreed.
- **Change propagation via an outbox:** any edit to a Loom-published colorway (field, price, image, size availability, lifecycle) enqueues an outbox event; a worker pushes to Loom keyed on stable ids, at-least-once, with a monotonic version so Loom can drop stale/duplicate deliveries.
- **Images to Loom:** decide delivery model (public/signed URLs vs proxied bytes, handoff §5/§11.6). Likely we re-host synced images in object storage and hand Loom fetchable URLs.

### 7.3 Field mapping reference

Threadflow `/products` → Master → Loom feed (abridged; full mapping in Phase 1 code):

| Master field | From Threadflow | To Loom feed | To Shopify |
|---|---|---|---|
| Style id / sku / name | `style_id` / `style_sku` / `style_name` | `style_id` / `style_sku` / `style_name` | product title (colorway-composed) |
| gender / unisex / category | same | same | tags / product type |
| Customs (hs/desc/weight/fiber) | style-level customs | colorway-level (resolved) | metafields (if used) |
| Colorway id/sku/name/color/hex | `colorway_*`, `swatch.hex` | `colorway_*`, `swatch.hex` | title/handle, `custom.color_hex` |
| brand | brand of style (TF hard-codes Livid) | `brand` (per product) | vendor |
| manufacturer_id + address | `manufacturer_id` + `/manufacturers/:id` | `manufacturer_id` (+ block) | — |
| country_of_origin | colorway-level | `country_of_origin` | — |
| prices (NOK/EUR/USD × msrp/ws) | `prices` | `prices` per season | variant price / compareAt |
| dropped → cancelled (per season) | `dropped` | per-season `cancelled` | status/archival |
| approved_for_production | `approved_for_production` | per-season flag | — |
| variants (sku/barcode/dimensions) | `variants[]` | `variants[]` | Shopify variants |

---

## 8. Lifecycle (three axes — handoff §6)

| Axis | Where stored | Set by | Effect |
|---|---|---|---|
| **Channel publish state** | `ChannelPublication.published` | Manager toggle (per product per channel) | `loom:false` (after true) → archive in Loom; explicit signal, never inferred |
| **Cancelled / dropped** | `SeasonEntry.cancelled` | Threadflow `dropped` (per season), changes each sync | Hidden that season in Loom; existing orders shown struck-through; reversible |
| **Archived** | `Colorway.archived` (+ derived from channel off) | Manager / channel-off | Hidden across all seasons in Loom; history kept; reversible |

Hard delete is **not** exposed via the feed. Future-season products that never go to production and sit on no Loom orders can be deleted only via an explicit, deliberate admin action later — not via sync.

---

## 9. Pricing & cost write-back

- **Season-scoped prices** as `(season × colorway × currency × type)` rows; MSRP in NOK, wholesale in NOK/EUR/USD; inherited by all variants (no per-size pricing). Precision `Decimal(14,2)`.
- **Livid prices** flow **from Threadflow** (calc lives there) → master → channels. **External prices** are edited in the master.
- Provide a **calculation/margin view** (in-price vs out-price, gross margin) and keep **season-level price history** so buy/sell prices are visible over time (per the brief).
- **Cost write-back (the only inbound write):** an ingest endpoint receives per-variant **weighted-average cost (NOK)** from Loom on each goods receipt, stores it on `Variant.averageCostNok`, and forwards it to Shopify (Sitoo picks it up natively). Contract shape is an open question (handoff §9.3 / §11.7).

---

## 10. Sync mechanics & scheduling

- **Daily scheduled** ingest + **manual trigger** button per season/mode. On Vercel, a Cron route (`/api/cron/threadflow-sync`) protected by a cron secret; elsewhere, a scheduled worker.
- **Idempotent, at-least-once**; every entity carries a version/`updated_at` so re-delivery is safe.
- **Reconciliation:** a periodic full snapshot per season as a safety net for missed pushes (cadence TBD, handoff §11.8).
- **Observability:** `SyncRun` log surfaced in the UI (last run, counts, errors, retry).

---

## 11. Open questions (must resolve with the Loom + Threadflow owners)

1. **Loom ingest contract** — webhook push vs pull; envelope, auth, batch size, event ids, versioning. (handoff §9.1)
2. **Variant SKU ownership** — master sends `variant_sku` (preferred) vs Loom derives; if master sends, confirm the 2-D `waist+length` suffix rule or plan a migration. Also: **Threadflow exposes no stable variant id** — confirm SKU is a safe match key. (handoff §2.2)
3. **Manufacturer delivery to Loom** — embedded in payload vs separate endpoint. (handoff §7.3)
4. **Season-less / continuity / external mapping** — confirm the `CONTINUITY` season approach vs a season-less mode. (handoff §4/§11.4)
5. **Weight unit** — confirm Threadflow `/products` `weight` is kg (doc says yes; older feed was grams). Master stores kg; Loom stores kg. (handoff §11.5)
6. **Image delivery to Loom** — public URLs, signed URLs, or proxied bytes; per-season imagery. We likely re-host synced images. (handoff §5/§11.6)
7. **Cost write-back endpoint** — confirm shape/auth for per-variant avg cost from Loom → master. (handoff §9.3/§11.7)
8. **Reconciliation cadence** — frequency of full/delta snapshots. (handoff §9.2/§11.8)
9. ~~**Hosting / deploy target**~~ — **Resolved:** Vercel (already hosted) → **Vercel Postgres** (Neon-backed) for the DB, **Vercel Cron** for the daily sync. Env vars in `.env.local` locally + Vercel Project Settings for deploy.
10. **Threadflow season identifiers** — map TF `seasonId`/`seasonCode` values to master `Season` records (a settings step).
11. **Channel-split field set** — confirm exactly which fields are channel-splittable vs. shared (§4.3), and whether the split is per-channel (Shopify/Loom) or also needs per-market/per-language granularity later.

---

## 12. Phased roadmap

Each phase is independently shippable and leaves the existing Shopify editor untouched.

### Phase 0 — Foundations
- Add Prisma + **Vercel Postgres**, `schema.prisma` (§4), first migration, env wiring (`DATABASE_URL` from Vercel Postgres; `THREADFLOW_URL`, `THREADFLOW_API_KEY`, `SHOPIFY_*` already in `.env.local`).
- New nav section **Catalog** (empty shell), new lib dirs `src/lib/{master,threadflow,loom}`.
- No behaviour change to existing screens.

### Phase 1 — Threadflow ingestion (read-only)
- Typed Threadflow client + response types; `/manufacturers` resolution.
- Upsert engine (§5.2) with barcode set-once, don't-clobber-customs, SyncRun logging.
- Manual sync trigger UI + season/mode selector; read-only browse of Styles/Colorways/Variants/Seasons.
- **Goal:** pull SS27 (incl. unapproved + dropped) into the master and browse it.

### Phase 2 — Enrichment editor & external products
- **Carry the full editing suite onto the master:** inline table editing of tags / status / vendor, all `custom.*` metafields (free-text + reference), the care/fitguide/collection/model **pickers**, **find & replace**, **column picker**, **group auto-linking**, and **fit models**.
- **Media manager** on the master: upload, gallery, drag-to-reorder (`MediaAsset`).
- Editable master fields with **field ownership/locking** (§5.3).
- Manual external-product creation with per-channel required-field validation (§6).
- Shopify carry-over importer (§5.5).

### Phase 3 — Channel model + Shopify push
- `ChannelPublication` UI (choose destinations per product).
- Shopify push mapping, reusing existing mutations; store GIDs; publish/unpublish flow.

### Phase 4 — Loom push
- Finalise Loom ingest contract (§11.1); build feed payload per `handoff.md`.
- Outbox + change-propagation worker; lifecycle signals (channels/cancelled/archived).
- Image re-hosting for Loom.

### Phase 5 — Pricing & cost write-back
- Season-scoped price editing, margin/calculation view, price history.
- Cost write-back ingest endpoint → variant cost → forward to Shopify.

### Phase 6 — Scheduling & hardening
- Daily cron, reconciliation snapshots, monitoring/alerting on sync failures.

### (Later) Phase 7 — Retire the live-Shopify plumbing
- By now the editor's functionality already lives in the master (Phase 2). This phase only removes the *old wiring*: the pages that read/write Shopify directly are switched off once the master's push flow is at parity. **No editing capability is lost** — it moved, it wasn't retired.
```
