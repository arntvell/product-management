# Vintage drops — implementation guide

**Branch:** `vintage-drops`, currently identical to `main` (`499be15`).
**Design rationale and cut-over strategy:** `docs/vintage-drops-integration.md`.
This document is the *how*: what to change, in what order, with the code already
verified by reading it.

---

## 0. Read this first — what is already handled

Four things you might expect to build already exist. Verified, with locations:

| Already true | Where |
|---|---|
| `enrich/shopify` is **allowlisted by source** — a new `VINTAGE` source is excluded by construction, no guard needed | `src/lib/master/enrich-shopify.ts:119` (`where: { source: { in: sources } }`) |
| `classify` **skips CONTINUITY** entries, so vintage in the CONTINUITY season is untouched | `src/lib/master/classify.ts:95` |
| Style **regrouping already excludes vintage** — one-of-ones won't be grouped under parent styles | `src/lib/grouping.ts:7` (`/vintage\|used\|preloved/i`) |
| A **drop is a first-class field** now — no need to encode it only as a tag | `SeasonEntry.drop`, indexed `[seasonId, drop]` |
| The push's media filter **accepts any public `https://` URL**, so vintage images need no Blob adoption | `isPublic` in `src/lib/master/push-shopify.ts` |

And five things that **must** be built. These are the real work:

1. `VINTAGE` on the `Source` enum (§1).
2. A vintage variant of the **readiness gate** — currently vintage is 100% blocked (§2).
3. `createExternalMedia` — `media.ts` has **no** create path for external URLs (§3).
4. `buildVintageDrop` — modelled on `buildProductsForBrand` (§4).
5. **Inventory quantity / policy / cost** on the Shopify push — not currently sent at all (§6).

---

## 1. Migration

Add one value. Additive, backward-compatible; existing code never selects it.

```prisma
enum Source {
  THREADFLOW
  MANUAL
  SHOPIFY_IMPORT
  CIN7_IMPORT
  VINTAGE
}
```

Follow the precedent migration `20260819125005_add_cin7_import_source`.

**After migrating, restart `npm run dev`** — Turbopack bundles the Prisma client and
a running server will reject the new enum value at runtime.

### The one guard that is actually needed

`normalize` is **not** source-scoped: it selects `where: { [field]: { not: null } }`
(`src/lib/master/normalize.ts:35`) and would recase vintage `vendor` /
`productType`. Its only protection is the `FieldOwner` `MANUAL` filter at
`normalize.ts:101`.

So: **`buildVintageDrop` must write `FieldOwner` `MANUAL` locks** for `vendor` and
`productType` (and every other field the entry UI writes). No code change to
`normalize` required — just don't skip the locks.

---

## 2. Readiness — vintage is currently blocked 100%

This is the most important finding in this document.

`shopifyMissing` (`src/lib/master/readiness.ts`) requires `swatchHex`,
`carePageId` and `fitguidePageId`. **A vintage garment has none of the three.**
Every vintage product would fail the gate at `push-shopify.ts:162`.

`pushColorwayToShopify` has an `allowIncomplete` escape (`push-shopify.ts:176`),
but it waives **all** merchandising checks — including `description` and `image`.
A missing image is precisely what caused the September 2026 outage. **Do not use
`allowIncomplete` for vintage.**

Instead, extend the input so the gate stays honest per product kind:

```ts
export interface ShopifyReadinessInput {
  // …existing fields…
  /** Vintage one-of-ones have no swatch, care page or fit guide. */
  kind?: "mainline" | "vintage";
}

export function shopifyMissing(i: ShopifyReadinessInput): string[] {
  const missing: string[] = [];
  if (!i.hasVariants) missing.push("variants");
  if (!i.hasPrice) missing.push("price");
  if (!has(i.description)) missing.push("description");
  if (i.hasImage === false) missing.push("image");
  if (i.hasTags === false) missing.push("tags");
  if (i.kind !== "vintage") {
    if (!has(i.swatchHex)) missing.push("swatch");
    if (!has(i.carePageId)) missing.push("care page");
    if (!has(i.fitguidePageId)) missing.push("fit guide");
  }
  return missing;
}
```

Vintage keeps `variants`, `price`, `description`, `image` and `tags` **required**.
Only the three merchandising references are waived, and only for vintage.

Keep this in `readiness.ts`. Its own header states it is the single source of truth
so "what the badge says and what the push enforces can never drift apart" — putting
a vintage exception anywhere else breaks that invariant.

Pass `kind: cw.source === "VINTAGE" ? "vintage" : "mainline"` at the call site.

---

## 3. Media — external images

`media.ts` exposes only `createBlobMedia`. Add a sibling:

```ts
export async function createExternalMedia(input: {
  colorwayId: string;
  url: string;
  alt?: string | null;
  role?: MediaRole;   // default GALLERY
}) // → sets source: "EXTERNAL", position: (max ?? -1) + 1
```

Mirror `createBlobMedia`'s position logic (`media.ts:28`). Leave `blobPathname`
null — `deleteMedia` only purges Blob objects when `source === "BLOB"`
(`media.ts:60`), so external assets delete cleanly.

Nothing else is needed: the push's `isPublic` test accepts
`https://vintage.lividjeans.com/13644.jpg` and sends it as gallery media with no
adoption step.

### Discovering the photos

Filenames are `<n>.jpg`, `<n>-2.jpg`, `<n>-3.jpg`. The count varies per item (2 or
3, verified: 13644 has three, 13671/13672/13673/13675 have two) and **is recorded
nowhere** — it must come from the actual directory, never from a formula.

```
^(\d+)(?:-(\d+))?\.jpe?g$      // group 1 = item number, group 2 = position (absent = base)
```

Two options:

- **Preferred — SFTP listing** with `ssh2` in a Node route. One connection, no rate
  limiting, and it sees photos for items not yet entered (useful for the entry UI's
  "photo with no row" check). Works on Vercel's **Node** runtime, *not* Edge.
  Folder: `/customers/7/4/b/c2pr36q0g/users/c2pr36q0g_ssh/webroots/by-route/vintage.lividjeans.com_`
- **Fallback — HTTPS probing** of `-2`/`-3` per SKU. The host returned `429` during
  a burst of ~25 rapid HEAD requests (threshold not measured), so batch, back off,
  and cache per SKU.

Sort ascending by group 2 (base photo = 0) so `position` 0 is the featured image.

---

## 4. `buildVintageDrop`

`buildProductsForBrand` (`src/lib/master/create.ts`) is the template — same
Style → Colorway → Variant → SeasonEntry → Price → ChannelPublication shape, same
`createMany` batching, same `P2002` → `ValidationError` handling, and it already
upserts the `CONTINUITY` season.

Differences for vintage:

| Field | Value |
|---|---|
| `Colorway.source`, `Style.source` | `VINTAGE` |
| `Colorway.colorwaySku` | the bare item number, e.g. `13644` — image URLs and the existing sheet both key on it |
| `Style.styleSku` | `VN-ONLN-13644` (= DEAR `ProductFamilySKU`) |
| `Variant` | exactly one, `sizeLabel` = Approx size else Størrelse |
| `Variant.variantSku` | **`VN-ONLN-13644-OS`** — build explicitly; the generic `` `${sku}-${size}` `` in `create.ts` would produce `13644-OS`, which is wrong |
| `Colorway.vendor` | `Vintage` |
| `Colorway.productType` | Kategori |
| `Colorway.tags` | `DROP<n>`, `rocket-hide`, `<BRAND>`, `hide` |
| `SeasonEntry.drop` | `DROP<n>` — the real field. Keep it in `tags` **as well**; the Shopify export needs it as a tag |
| `SeasonEntry.seasonId` | the `CONTINUITY` season (reuse `create.ts`'s upsert) |
| `Price` | `NOK` / `MSRP` / Pris nett |
| `Style.hsCode` | `63090000` |
| `Style.customsDescription` | `Used Vintage garment` |
| `Style.weightKg` | `0.5` |
| `Colorway.countryOfOrigin` | `United Kingdom` |
| `ChannelPublication` | `SHOPIFY` only — vintage is not a Loom product |

The customs constants come straight from the sheet's `2. EXPORT DEAR`
(`AdditionalAttribute1=GB`, `2=63090000`, `3=Used Vintage garment`, `Weight=500`
gram, `CountryOfOrigin=United Kingdom`). They land in the same fields
`enrich/cin7` fills for mainline products, so nothing bespoke is needed.

Write `FieldOwner` `MANUAL` locks for every field the UI sets (§1).

### Validation — fail loudly

The sheet fails silently; that is what this replaces. Reject or flag:

- no photo at all; no base `<n>.jpg` (a numbered shot would become the featured image)
- a photo on the host with no matching row
- missing measurements for the declared `Type mål`
- missing barcode; missing price; duplicate item number
- any image URL that does not return `200` + `Content-Type: image/*`

---

## 5. Body HTML — three templates

`1. EXPORT SHOPIFY`!C2 selects between three bodies. Store the result in
`Colorway.fullDescription` (what the push reads at `push-shopify.ts:158`).

| Condition | Body |
|---|---|
| `Type mål = 1` | copy + **Chest width** + **Front Length**, then the "Hot tip for buying vintage online" block |
| `Type mål ≠ 1`, Approx size blank | copy + **Waist** + **Front rise** + **Inseam Length**, then the same "Hot tip" block |
| `Type mål ≠ 1`, Approx size set | copy + **Standardized contemporary size** + **Tagged size** + Waist/Front rise/Inseam, then the longer vintage-Levi's sizing explainer |

**Port these by reading the C2 formula, not by retyping.** They are customer-facing
copy that has been live for years. Hold them as templates (data), not inline strings.

---

## 6. Shopify push extension

The push currently sends **no inventory quantity, no inventory policy, and no cost**
— a grep of `push-shopify.ts` for `inventoryQuantit|inventoryPolic|cost|tracked`
returns nothing. Vintage needs all three, so this is an extension, not reuse.

On the variant payload (`push-shopify.ts:191`, currently `optionValues`, `price`,
`inventoryItem.sku`, `barcode`), add for vintage:

- `inventoryQuantities` → 1 at the sales location
- `inventoryPolicy: DENY` (one-of-one must never oversell)
- `inventoryItem.cost` → the `COST` lookup on *Opprinnelig produkt*, rounded,
  defaulting to `100`
- `inventoryItem.tracked: true`

Also: `Handle` = `lower("<n>-vintage")`, `Title` = `<Tittel> (<Approx size or
Størrelse>)`, one `Size` option (already how the push builds options).

**Non-vintage behaviour must be byte-identical after this change.** Gate the new
fields on the vintage kind and diff a mainline push before and after.

---

## 7. Cin7 — CSV, not a push

There is no Cin7 push target (`src/app/api/catalog/push/` holds only `loom/` and
`shopify/bulk/`); everything Cin7-bound leaves as CSV today. Keep that.

Port `2. EXPORT DEAR` as an export over master rows. ~90 columns, nearly all
constants: `Brand=Vintage`, `Type=Stock`, `CostingMethod=FIFO`, `Weight=500`,
`WeightUnits=gram`, `DefaultUnitOfMeasure=Item`, `ProductAttributeSet=Product
attributes`, `SaleTaxRule=Tax on sales`, `Status=Active`, `Sellable=YES`,
`HSCode=63090000`, `CountryOfOrigin=United Kingdom`, `PriceTier2=0`.

Variable: `ProductCode` (`VN-ONLN-<n>-OS`), `ProductFamilySKU` (`VN-ONLN-<n>`),
`Name`, `ProductFamilyName`, `Category`, `Barcode`, `PriceTier1`,
`ProductFamilyOption1Value`, `CommaDelimitedTags` (`DROP<n>,Zoom,NOSYNC` — note
these differ from the Shopify tags), `Description`.

---

## 8. Entry UI

`/catalog/vintage/drops/[n]`, following the patterns in `/catalog/products/new` and
`/catalog/drops`. The sheet's `INPUT` columns are the form spec: Nummer, Tittel,
Beskrivelse, Kategori, Opprinnelig produkt, Retail Opprinnelig, Pris nett,
Chest Width / Front Length, Waist / Front Rise / Inseam, Størrelse, Approx size,
Type mål, Tags (drop), Barcode, BRAND.

Show the item's photos beside the form — that is the capability the spreadsheet
never had, and the reason a wrong-photo-to-row mismatch is currently invisible.

Report ingest results through `SyncRun`, respecting the three-way split documented
in ONBOARDING §3: `errors` for real failures only, `warnings` for informational
notes, `skipped` for deliberately-unwritten items.

---

## 9. Verification

1. Dry-run **every** pipeline pass with vintage rows present — `enrich`,
   `normalize`, `classify`, `import/cin7` — and confirm each reports zero vintage
   writes. Two are safe by construction (§0) but prove it rather than assume it.
2. **Golden-file diff**: generate the Matrixify CSV and the DEAR CSV from Origio and
   from the sheet for the same drop, and diff them. The sheet has been correct for
   four years — it is the test oracle.
3. Only after both diff clean, enable the live Shopify push behind a flag.
4. Run one more drop in parallel before retiring the sheet.

---

## 10. Landmines

- **Never run `import/shopify` with vendor `Vintage`** once the master owns vintage.
  The Shopify catalogue already contains the vintage products
  (`import-shopify.ts:192` warns about exactly this), and importing them as
  `SHOPIFY_IMPORT` would collide on `Colorway.colorwaySku @unique`.
- **The database does not branch.** One shared Neon Postgres, so a migration from
  `vintage-drops` lands in the data production reads. Additive only.
- **Restart `npm run dev`** after the enum migration, or you get runtime enum
  rejections that look like validation bugs.
- `import/cin7` marks products dropped when out of stock. Every vintage SKU will
  legitimately go to zero and stay there — dry-run against vintage rows and decide
  that behaviour explicitly rather than inheriting it.
- Sold vintage items should use `Colorway.archived` (whole-channel), not
  `SeasonEntry.cancelled` (dropped from one season).

---

## Order of work

1. Migration + `MANUAL`-lock convention (§1).
2. Readiness `kind` (§2) — smallest change that unblocks everything else.
3. `createExternalMedia` + photo discovery (§3).
4. `buildVintageDrop` with validation (§4, §5).
5. Read-only vintage view — list what's on the host, show thumbnails. Useful as a QA
   tool even while the sheet still runs drops.
6. Entry UI (§8).
7. Matrixify CSV export → golden-file diff (§9.2).
8. DEAR CSV export → golden-file diff.
9. Push extension (§6) behind a flag, after both diffs are clean.
10. Retire the sheet.
