# Fit guides for FW26 — what we can actually work with

**As of 2026-09-15.** Question asked: *can we build FW26 fit guides from the
measurements Threadflow holds?*

**Short answer: yes, for 55 of the 74 FW26 styles — today.** Threadflow's
`includeMeasurements=true` (handover `threadflow-measurement-charts-handover.md`,
2026-09-15) **went live during this session** — the same call that returned 3,554
bytes and no `measurement_chart` key now returns 23,464 bytes and a full chart.

All 74 FW26 styles have a chart, no nulls, no unresolved base sizes, and the size
columns join to our variants by name on 68 of 69 styles that have variants.

**The one thing that blocks the rest: 19 charts are ungraded on the rows a fit
guide shows** — one value repeated at every size. Those cannot produce a table,
and no amount of work on our side fixes it; it is data entry in Threadflow. §10
has the list and the ask.

§1 records what the feed carried **before** the change — the baseline, and still
what `src/lib/threadflow/types.ts` declares.

---

## 1. What the Threadflow API exposes today (pre-change)

Pulled the whole FW26 feed (`includeUnapproved`, `includeDropped`):
**74 styles · 132 colorways · 900 variants.**

Nothing measurement-shaped is in it. The style payload is exactly what
`src/lib/threadflow/types.ts` already declares:

```
category  colorways  customs_description  fiber_composition  fit_pictures
gender  hs_code  season_description  size_override  style_id  style_name
style_sku  subcategory  unisex  weight
```

Variants carry `sku`, `barcode`, `dimensions` — nothing else.

The two fields that sound like they might carry fit data do not:

| Field | FW26 | What it actually is |
|---|---:|---|
| `fit_pictures` | **0 of 74** | Lookbook model shots. Downloaded one (SS27 Keri, `linesheet-derivatives/fit/…webp`, 1067×1600) — a photograph of a model wearing the jeans. Not a chart. |
| `size_override` | **0 of 74** | A size *range* (`{low, high}`), e.g. `{XS, XL}`. No measurements. |

Coverage elsewhere, for reference: SS26 0/63, SS27 5 fit pictures + 1 size
override of 174 styles. So the fields work — they are just sparsely used, and
they were never measurements.

**No measurement endpoint responds.** This is the state the handover changes.
Probed `/measurements`, `/sizes`,
`/size-charts`, `/fit`, `/fitguides`, `/seasons`, and per-id detail routes
(`/products/:id`, `/styles/:id`, `/colorways/:id`, `/products/:id/measurements`).
Every one returns the Threadflow SPA's HTML shell — the API's way of saying 404.

These were guessed route names, so this was "none of the plausible routes
exist", not a proven absence — and the handover settles it: measurements are not
a new endpoint at all, they are an opt-in key on `/products`.

One endpoint we don't currently use *does* exist: `GET /styles?seasonCode=…`. It
is a flat colorway list (product/colorway sku, name, manufacturer, dropped,
approved). No measurements there either.

## 2. What Threadflow is sending

I had reconstructed the model from their app bundle before the handover arrived;
the handover confirms it and names everything. Three layers:

- a **template chart** ("Woven Shirt") owning a catalogue of measurement rows,
  each with a permanent `measurement_definition_id`, shared across many styles;
- a **per-season chart instance** per style (`style_chart_id`, new every season),
  carrying the actual numbers;
- **per-season enable/hide** of rows and size columns on that instance.

Only the base size is authored — the rest is computed from a grading increment
with occasional per-size overrides — but **the feed sends the computed grid**, so
we never implement grading. It also sends `base_value` / `grading_increment` /
`grading_skip` so the grid can be audited.

The mapping keys, from their §4:

| Key on | Field | Note |
|---|---|---|
| A measurement row | `measurement_definition_id` | Stable for the life of the row, across seasons and across every style on the template. |
| A size column | `size_id` | `size_name` is a display label. |
| The row catalogue | `chart_template_id` | Stable; groups styles that share rows. |
| This season's snapshot | `style_chart_id` | **New every season — a version key, never a mapping key.** |

Do not map on `code`: it is auto-incrementing *within a template*, so it collides
across templates. `(chart_template_id, code)` is valid if a readable key is
wanted.

Three behaviours worth writing into the importer now:

- `measurement_chart: null` means the style has no chart this season; the key is
  absent entirely without the flag.
- `value: null` is a **real gap** — never fall back to `base_value`. A whole chart
  of nulls with `base_size.source: "unresolved"` is a data issue to report back to
  them.
- `is_title: true` rows are section headings — no unit, no tolerances, no values.
- Ignore unrecognised keys rather than failing (their §9).

**A chart is on the STYLE, per SEASON — not per colourway.** That matches our
`Style` + `SeasonEntry` shape. Their storage proposal (§5: a row catalogue keyed
on `measurement_definition_id`, a per-season instance keyed on `style_chart_id`,
values keyed on `(style_chart_id, measurement_definition_id, size_id)`) maps onto
our schema without strain. Not building it yet — the shape may still move after
the reply in §7.

## 3. What a fit guide is on our side today

A Shopify **page**, referenced from the product by the `custom.fitguide`
page_reference metafield — `Colorway.fitguidePageId` in the master, pushed by
`publish.ts:86` / `push-shopify.ts:85`.

Of 354 Shopify pages, **207 are fit guides, 186 with an HTML measurement table.**
They are per style, per season, and the current naming convention is
`<Style> SS26 - FitGuide` (57 of those).

Predominantly two table shapes:

- **Tops / outerwear** — Size · Front Length · Shoulders · Chest (pit-to-pit) · Bottom Opening (± Sleeve Length)
- **Bottoms** — Size · Waist · Thigh · Knee · Leg · Rise · Backrise

Plus prose above the table (how the garment fits, how to size up/down) and
"All measurements in CMs."

The exceptions matter for route (c)'s scope: skirts and dresses use
length/waist/hip (Blanche, Heist, Bowser, Turnip), scarves use
length/width/rib-height (Lerke, Hilda), and footwear is a size-conversion table
with no garment measurements at all (Novesta, Norda) or prose only (Birkenstock,
Paraboot, Red Wing, Clarks, Diemme — 21 of the 207 have no table). Column
*naming* is also unstandardised across seasons: `Waist`, `Waist 1/2`,
`Waist cm` are the same measurement.

**There are zero FW26 fit guide pages.**

## 4. The master never imported the links that already exist

| | |
|---|---:|
| Shopify active products carrying `custom.fitguide` | **309** |
| Master colorways carrying `fitguidePageId` | **1** of 4,584 |
| Of the 309, joinable to a master colorway by `ChannelPublication.externalId` | **309 — all of them** |

**This is not a backfill that was never written — it is an importer that only
ever mapped free text.** `import-shopify.ts:101` declares:

```ts
const METAFIELD_MAP: Record<string, string> = {
  short_description: "shortDescription",
  full_description:  "fullDescription",
  details:           "details",
  style_tagline:     "styleTagline",
  style_name:        "styleName",
};
```

Five free-text keys, plus `color_hex` handled separately. **None of the four
reference metafields are in it** — `fitguide`, `care_page`, `model_info`,
`recommended_product_from_collection` — nor the product-reference lists. The
master's coverage shows exactly that split:

| Field | In master | | Field | In master |
|---|---:|---|---|---:|
| `fullDescription` | 2,659 | | `fitguidePageId` | **1** |
| `styleName` | 658 | | `carePageId` | **63** |
| `swatchHex` | 611 | | `modelInfoId` | **1** |
| `shortDescription` | 42 | | `recommendedCollectionId` | **1** |

The text enrichment ran. The references were never in scope. (`enrich-shopify.ts`
is a different job — tags, vendor, product-type onto Cin7 carry-overs — and
reads no metafields at all.)

Two consequences:

1. **Fix the map, don't write a one-off.** Adding the four reference keys to
   `METAFIELD_MAP` is the same change that fixes `care_page`, `model_info` and
   the recommended collection. Note the importer only runs on *new* imports —
   it creates styles and colorways — so an update path is needed for the 309
   products already in the master.
2. **A live hazard, and it is quantified.** `buildShopifyPreview` puts every
   blank reference key into `emptyMetafieldKeys`, and `push-shopify.ts:340`
   deletes those keys on Shopify when the caller passes `clearEmptied`. Of the
   **128** FW26 colorways that have a Shopify publication, **106 sit on a live
   product that carries `custom.fitguide` today** — and the master is blank for
   every one of them. An FW26 push with "clear emptied fields" ticked would
   strip the fit guide off all 106, plus `care_page`, `model_info` and the
   recommended collection. It is guarded — opt-in, and it warns otherwise — but
   C1's unverified Shopify push is exactly where someone would tick it.
   **Fix the map before that push.**

## 5. FW26 status, style by style

*Scope: this is Threadflow's 74 FW26 styles. The master's FW26 is larger — 237
merchandise colorways, of which 161 came from Threadflow and 76 from the Cin7
import (carry-overs with no Threadflow id). Those 76 are outside this table and
need their own pass.*

Of the 74: 40 have a fit guide from an earlier season whose measurements would
need re-checking against the FW26 chart; **34 have no fit guide page in any
season.**

### FW26 styles with an existing guide to carry forward (40)

| Style SKU | Name | Category | CW | Var | Existing guide page(s) |
|---|---|---|--:|--:|---|
| `LIV-M-BRNS` | Barnes | Jeans | 6 | 74 | Barnes Fitguide, Barnes SS26 - FitGuide |
| `LIV-W-BTH` | Beth | Jeans | 6 | 121 | Beth Fitguide, Beth SS26 - FitGuide |
| `LIV-W-BTH-CRD` | Beth Cord | Jeans | 1 | 0 | Beth Fitguide, Beth SS26 - FitGuide |
| `LIV-M-BRLY` | Burley | Jeans | 1 | 0 | Burley Fitguide |
| `LIV-M-FLY-TWSTD` | Fealy Twisted | Jeans | 1 | 14 | Fealy Twisted SS26 - FitGuide, fealy Fitguide |
| `LIV-W-FRNCS` | Frances | Jeans | 1 | 20 | Frances SS26 - FitGuide |
| `LIV-M-FLLR` | Fuller | Jeans | 5 | 60 | Fuller SS26 - FitGuide, Fuller fitguide |
| `LIV-W-KR` | Keri | Jeans | 2 | 11 | Keri Fitguide, Keri Linen Fitguide, Keri Linen SS26 - FitGuide, Keri SS26 - FitGuide, Keri Surf SS26 - FitGuide |
| `LIV-M-MK` | Miko | Jeans | 4 | 58 | Miko SS26 - FitGuide, Miko fitguide |
| `LIV-W-SRN` | Siren | Jeans | 1 | 11 | Siren SS26 - FitGuide, Siren fitguide |
| `LIV-W-T` | Tia | Jeans | 2 | 39 | Tia Fitguide, Tia SS26 - FitGuide |
| `LIV-W-BBY` | Abby | Jersey | 1 | 5 | Abby Fitguide, Abby SS26 - FitGuide |
| `LIV-M-TH` | Atohi | Jersey | 2 | 8 | Atohi SS26 - FitGuide |
| `LIV-W-CV` | Cavi | Jersey | 1 | 5 | Cavi fitguide |
| `LIV-M-DYR` | Dyer | Jersey | 1 | 4 | Dyer Fitguide, Dyer SS26 - FitGuide |
| `LIV-W-D` | Ida | Jersey | 1 | 5 | Ida Fitguide |
| `LIV-M-KLLR` | Keller | Jersey | 2 | 10 | Keller Fitguide, Keller fitguide |
| `LIV-W-LM` | Lima | Jersey | 1 | 4 | Lima Fitguide |
| `LIV-W-ML` | Mila | Jersey | 1 | 5 | Mila Fitguide, Mila SS26 - FitGuide |
| `LIV-M-NLSN` | Nelson | Jersey | 4 | 22 | Nelson FW24 Fitguide, Nelson Fitguide, Nelson SS26 - FitGuide |
| `LIV-M-NY` | Noya | Jersey | 1 | 4 | Noya SS26 - FitGuide |
| `LIV-M-PC` | Paco | Jersey | 2 | 10 | Paco SS26 - FitGuide |
| `LIV-M-PLL-VR` | Pull Over | Jersey | 1 | 5 | Pull fitguide |
| `LIV-M-RCHMND` | Richmond | Jersey | 3 | 5 | Richmond Fitguide, Richmond SS26 - FitGuide |
| `LIV-W-DK` | Deka | Knitwear | 4 | 12 | Deka fitguide |
| `LIV-M-PLL` | Pull | Knitwear | 1 | 4 | Pull fitguide |
| `LIV-M-STCK` | Stack | Knitwear | 2 | 8 | Stack Fitguide |
| `LIV-M-BLK` | Blake | Outerwear | 1 | 6 | Blake Fitguide |
| `LIV-M-GLLSH` | Gillish | Outerwear | 1 | 5 | Gillish fitguide |
| `LIV-M-DN` | Aiden | Shirt | 4 | 16 | Aiden Fitguide |
| `LIV-W-MBR` | Amber | Shirt | 1 | 4 | Amber SS26 - FitGuide |
| `LIV-W-LS` | Lais | Shirt | 1 | 5 | Lais SS26 - FitGuide |
| `LIV-W-TK` | Tiki | Shirt | 3 | 15 | Tiki Fitguide, Tiki SS26 - FitGuide |
| `LIV-M-HYS-DBL-BRSTD-JCKT` | Hayes Double Breasted Jacket | Suiting | 2 | 9 | Hayes Fitguide |
| `LIV-M-HYS-SNGL-BRSTD-JCKT` | Hayes Single Breasted Jacket | Suiting | 1 | 4 | Hayes Fitguide |
| `LIV-W-FR` | Fir | Suitpant | 1 | 5 | Fir fitguide |
| `LIV-M-HYS-STRGHT-STPNT` | Hayes Straight Suitpant | Suitpant | 1 | 8 | Hayes Fitguide |
| `LIV-M-HYS-WD-STPNT` | Hayes Wide Suitpant | Suitpant | 3 | 25 | Hayes Fitguide |
| `LIV-M-BRNS-WRK-ST-TRSR` | Barnes Work Suit Trouser | Trouser | 2 | 0 | Barnes Fitguide, Barnes SS26 - FitGuide |
| `LIV-M-FLLR-CHN` | Fuller Chino | Trouser | 2 | 30 | Fuller SS26 - FitGuide, Fuller fitguide |

### FW26 styles with no fit guide page in any season (34)

| Style SKU | Name | Category | CW | Var |
|---|---|---|--:|--:|
| `LIV-W-BN` | Binou | Accessories | 2 | 2 |
| `LIV-M-CLLM` | Collum | Accessories | 2 | 2 |
| `LIV-W-ST` | Asta | Jeans | 1 | 19 |
| `LIV-W-TR-TWSTD` | Tori Twisted | Jeans | 1 | 17 |
| `LIV-W-LPH` | Alpine | Jersey | 1 | 5 |
| `LIV-W-BH` | Buhai | Jersey | 1 | 4 |
| `LIV-M-CRW` | Crew | Jersey | 2 | 10 |
| `LIV-M-TDDY` | Teddy | Jersey | 2 | 9 |
| `LIV-W-K` | Aiko | Knitwear | 1 | 4 |
| `LIV-W-LLGR` | Allegra | Knitwear | 1 | 4 |
| `LIV-W-BCK` | Becka | Knitwear | 1 | 4 |
| `LIV-W-BLR` | Blair | Knitwear | 1 | 4 |
| `LIV-M-CRDGN` | Cardigan | Knitwear | 1 | 5 |
| `LIV-M-CLRK` | Clerk | Knitwear | 1 | 4 |
| `LIV-M-RMBLR` | Rambler | Knitwear | 2 | 8 |
| `LIV-W-RM` | Rima | Knitwear | 1 | 4 |
| `LIV-W-SLD` | Selda | Knitwear | 1 | 4 |
| `LIV-M-BL` | Balo | Outerwear | 1 | 5 |
| `LIV-W-BX` | Bix | Outerwear | 2 | 8 |
| `LIV-M-NX` | Nox | Outerwear | 1 | 4 |
| `LIV-M-NX-001` | Nox | Outerwear | 1 | 0 |
| `LIV-M-PL-CT` | Polo Coat | Outerwear | 1 | 6 |
| `LIV-M-PL-CT-CMMNT-TSTNG` | Polo Coat (comment testing) | Outerwear | 1 | 0 |
| `LIV-M-VNC` | Vinc | Outerwear | 1 | 5 |
| `LIV-M-PT` | APT | Shirt | 5 | 23 |
| `LIV-M-CSL-SHRT` | Casual Shirt | Shirt | 2 | 9 |
| `LIV-M-DLBRT` | Deliberate | Shirt | 2 | 10 |
| `LIV-M-XTNSV` | Extensive | Shirt | 2 | 8 |
| `LIV-M-CCSNL` | Occasional | Shirt | 2 | 4 |
| `LIV-M-TMST` | Utmost | Shirt | 2 | 10 |
| `LIV-M-WSTRN-SHRT` | Western Shirt | Shirt | 2 | 10 |
| `LIV-M-WRK-SHRT` | Work Shirt | Shirt | 1 | 5 |
| `LIV-W-GR` | Agra | Skirt | 1 | 4 |
| `LIV-M-SLC-CHN` | Solace Chino | Trouser | 2 | 24 |

Also from this pull: **the customs gap is largely closed at source.** 72 of 74
FW26 styles now carry HS code, customs description and weight from Threadflow.
Only `LIV-W-BN` (Binou) and `LIV-M-CLLM` (Collum) are blank. Fibre composition
is still thin — 27 of 74.

## 6. Joining the chart to our variants

Their §7 warns that the chart's sizes are a different axis from the colourway's
`variants`. Checked against the master's 1,899 FW26 variants:

| Shape | Variants | Joins to a chart size? |
|---|---:|---|
| 2-D split — `dim1` waist, `dim2` length | 1,128 | **Yes**, on `dim1`. One chart column maps to every length at that waist — which is what the existing pages already show (Keri lists `23'`, `24'`…, no lengths). |
| 1-D alpha — `XS`…`3XL`, `M/L`, `OS` | 753 | **Yes**, on `dim1` by name. |
| 1-D bare numeric — waist, no length | 10 | **Yes**, on `dim1`. Inconsistent with their 39 split siblings, but it joins. |
| **Unsplit — a 2-D value sitting whole in `dim1`** | **8** | **No.** |

So the join is sound and the exception is eight variants, all one colorway:
`LIV-HYS-ST-PNT-BLCK`, whose sizes are stored as `28/34`…`36/34` in `dim1` with
`dim2` null. It is categorised `Suiting` rather than `Suitpant`, which is very
likely why `normalize-size-labels.ts` skipped it. Pre-existing, unrelated to fit
guides, and a small fix.

**Expected, not an error:** a variant with no chart value. A style can be sold in
S–XXL and specced S–XL (their §7). The renderer shows the sizes the chart has —
it must not invent a row or reuse a neighbouring size's number.

**Still to resolve:** we hold no Threadflow `size_id` anywhere — `Variant` has
`sizeLabel` / `dim1` / `dim2` strings only. Their advice is "join on `size_id`",
but the variant payload gives us names alone. See §7.

## 7. Open points with Threadflow

The shape is live, so these are post-launch asks rather than shape feedback.
Point (c) from the original draft is answered: `X-API-Key` works, their §1's
`Authorization: Bearer` is a typo in the handover.

**a. Fill in the grading increments on 19 FW26 charts** — *the primary ask.*
Precisely stated, because §8 shows the base values are already right: these
charts have `grading_increment: 0`, so the computed grid repeats the base size at
every size. It is not that the spec is missing — it is that one number per row
is. Same story on 54 of 63 SS26 charts. Agra, Rambler and the two Hayes
suitpants additionally have a page row absent from the chart; Binou and Collum
hold only one or two rows and look simply unfinished.

**b. A customer-facing flag per row** — *nice to have, no longer blocking.* The
row selection is a fixed rule (§8), so Origio can apply it without Threadflow's
help. The flag would still be worth having as drift protection: it is their
template, and a renamed or re-scoped row would silently change what we publish.
Low priority against (a).

**c. `size_id` on the colourway's variants.** Not added — `variants[].dimensions`
still carries names only, so their own "map sizes on `size_id`" advice can't be
followed. The name join works today (68 of 69 styles) and stays fragile: one
`2XL`→`XXL` rename breaks it silently.

## 8. Go-live results (run 2026-09-15)

The flag started answering during this session. What came back:

| | FW26 | SS26 |
|---|---:|---:|
| Styles with a `measurement_chart` | **74 of 74** | 63 of 63 |
| Charts with an unresolved base size | 0 | 0 |
| Measurement values that are `null` | **0 of 1,867** | 0 |
| Templates in use | `Top` 41 · `Bottom` 20 · `Outerwear` 9 · `Suiting` 2 · `Accessories` 2 | |
| Measurement rows per chart | min 1 · median 26 · max 44 | |

**The size join works on names.** Of the 69 FW26 styles that have variants, 68
have a chart column for every size they sell. The single exception is Barnes,
sold in waist 27 but specced from 28 up — which is the expected case from their
§7, not an error.

`size_id` was **not** added to the variant payload, so reply point (b) stands —
we join on names. It works today; it stays fragile.

### The real quality problem is flatness, not nulls

*(Corrected 2026-09-15 after checking a page against its chart at the base size.
An earlier version of this section concluded the pages were authored
independently of the charts. That was wrong — see below.)*

"Zero nulls" is true and misleading. Values are present everywhere — but on many
rows they are **the base size's value repeated at every size**, because
`grading_increment` is 0. Threadflow's own admin vocabulary names this state
(`"flat-base": "Base-size values stored for every size"`).

**The pages are generated from these charts, and the charts' base values are
correct.** Compared at the chart's own base size rather than across all sizes:

| SS26 styles with both a page and a chart | |
|---|---:|
| Every page row matches the chart's base value exactly | **43 of 52** |
| One row differs | 8 — **all of them my row mapping, not the data** |
| Base size absent from the page table | 1 |

Miso is the clean illustration. Its chart's base size is S, and every row is
flat. The chart says `Shoulder (across)` 25, `½ Width (pit to pit)` 42,
`½ Bottom Width` 45, `Front Length (from HPS)` 52. The published page's S row
reads 25 / 42 / 45 / 52, and then grades outward — XS 23.5, M 26.5, L 28.

So the chart is not unfilled and the page is not independent. **The only thing
missing from an SS26 chart is the grading increment.** The base spec is right;
54 of 63 charts simply never had the increments entered. That is a much smaller
and much more fixable problem than "the charts are empty", and it is why the
first comparison — across all sizes, against a flat grid — failed everywhere.

### The row selection rule

Settled by the business, 2026-09-15 — it is not a per-style judgement after all:

**Tops — four columns, in this order:**

| Page column | Chart row |
|---|---|
| Shoulders | `Shoulder (across)`, else `Shoulder Width` |
| Chest (pit-to-pit) | **the row named "pit to pit"** (`½ Width (pit to pit)`); **only if no pit-to-pit row exists**, `½ Chest Width` |
| Bottom Opening | `½ Bottom Width`, else `½ Hem` |
| Front Length | `Front Length (from HPS)` — never `Front Length (from collar)` |

**Bottoms — six columns:** `½ Waist` · `½ Thigh` · `½ Knee (35 cm)` ·
`½ Leg Opening` · `Front Rise (without waistband)` · `Back Rise (without
waistband)`. Unanimous across every page checked.

Applied to FW26 this resolves **55 of 74 styles completely** — the same 55 whose
rows are graded, so the rule adds no new losses. The fallbacks barely fire: 52 of
56 tops charts carry `½ Width (pit to pit)`, so `½ Chest Width` is **never
needed** in FW26; `½ Hem` is used twice and `Shoulder Width` twice.

**Tops is no longer blocked.** The earlier reading — that the chest row was a
per-garment choice we could not safely make for 49 of 74 styles — was wrong. It
was one rule, applied inconsistently by hand in the past.

### Which means four live pages are wrong

The styles that made the choice look ambiguous were pages that broke the rule.
They publish `½ Chest Width` while a pit-to-pit row exists on the same chart, so
the chest measurement is understated by a wide margin:

| Live page | Publishes | Rule says | Error |
|---|---:|---:|---:|
| `Initial SS26 - FitGuide` | 41.0 | 58.5 | **+17.5cm** |
| `Brass Tee SS26 - FitGuide` | 47.5 | 64.0 | **+16.5cm** |
| `Pen SS26 - FitGuide` | 51.5 | 63.5 | **+12.0cm** |
| `Richmond SS26 - FitGuide` | 40.5 | 52.0 | **+11.5cm** |

At the chart's base size; the error runs through every size.

**Two of the four can be corrected from source; two cannot.** *(Revised — an
earlier version said all four needed the increment assumed. That was only true
of the SS26 chart in isolation. The same style's other seasons carry the
grading, and `measurement_definition_id` is stable across them.)*

| Style | Graded chart elsewhere | Sourced pit-to-pit |
|---|---|---|
| **Richmond** | FW26 **and** SS27, identical, `grading_increment: 2` | 50 · 52 · 54 · 56 · 58 (S–2XL) |
| **Initial** | SS27, `grading_increment: 2`, same base (58.5) | 56.5 · 58.5 · 60.5 · 62.5 · 64.5 (S–2XL) |
| Brass Tee | none — SS26 only, increment 0 | not available |
| Pen | none — SS26 only, increment 0, `Outerwear` template | not available |

For Richmond and Initial nothing is assumed: the base value, the increment and
every per-size value come from Threadflow. The only judgement left is the sizes
the page carries beyond the chart's range — Initial's page runs S–XXXL while the
chart stops at 2XL, and Richmond's page starts at XS where the chart starts at S.

Brass Tee and Pen have no graded chart in any season, so correcting them still
means either Threadflow filling the increment or keeping the page's own 2.0cm.
**Leave them until it is filled** rather than write an assumed number to a live
page.

### The same trick makes the grading ask concrete

Eight of the eighteen skipped FW26 styles have a graded chart in an adjacent
season whose **base values still agree with FW26** — which means FW26's increment
was simply never entered, and the adjacent season already shows what it should
be:

| FW26 style | Graded in | Rows graded / base agrees |
|---|---|---|
| Abby | SS27 | 9 / 9 |
| Cavi | SS27 | 11 / 11 |
| Hayes Wide Suitpant | SS27 | 12 / 12 |
| Mila | SS27 | 11 / 10 |
| Nelson | SS27 | 14 / 12 |
| Noya | SS27 | 19 / 12 |
| Paco | SS27 | 16 / 8 |
| Fir | FW25 | 9 / 8 |

Worth sending with the ask — it turns "please grade these" into "the increment is
on the SS27 chart and the base matches; it looks like it was missed on FW26."

**Not a licence to copy the values across.** A spec can legitimately change
between seasons, and Paco's 8-of-16 agreement says some did. Threadflow should
fill FW26, not us.

The remaining ten — Agra, Alpine, Binou, Collum, Hayes Straight Suitpant, Ida,
Keller, Rambler, Selda, Tia — have no graded chart anywhere and need the numbers
entered from scratch.

Richmond is also an FW26 style, and its FW26 chart *is* graded, so the FW26 page
generated for it is correct regardless.

### FW26, by whether a page can be generated

Measured against the rows the existing pages actually show — tops:
Shoulders / Chest (pit-to-pit) / Bottom Opening / Front Length; bottoms:
Waist / Thigh / Knee / Leg / Rise / Backrise.

| | Styles |
|---|---:|
| **Every page row present and graded — generate today** | **55** |
| Some rows missing or flat | 4 |
| No page row graded | 15 |

| Style | | Problem |
|---|---|---|
| `LIV-W-BBY` Abby, `LIV-W-LPH` Alpine, `LIV-W-CV` Cavi, `LIV-M-KLLR` Keller, `LIV-W-ML` Mila, `LIV-M-NLSN` Nelson, `LIV-M-NY` Noya, `LIV-M-PC` Paco, `LIV-W-SLD` Selda | tops | All four rows **flat** |
| `LIV-M-BRLY` Burley, `LIV-W-T` Tia | bottoms | All six rows **flat** |
| `LIV-W-D` Ida | tops | Three flat, `Front Length` absent |
| `LIV-W-BN` Binou, `LIV-M-CLLM` Collum | tops | Chart exists but holds 1–2 rows; none of the page rows |
| `LIV-W-FR` Fir | eu | None of the page rows on the chart |
| `LIV-W-GR` Agra | tops | Three of four rows absent |
| `LIV-M-RMBLR` Rambler | tops | `Shoulders` absent |
| `LIV-M-HYS-STRGHT-STPNT`, `LIV-M-HYS-WD-STPNT` Hayes suitpants | bottoms | `Leg opening` absent; other five graded |

Binou and Collum are the same two styles missing HS code and weight in §5 — they
look simply unfinished in Threadflow.

### The row mapping, and how far it is actually verified

From the pages that reproduce their chart:

| Chart row | Page column |
|---|---|
| `Shoulder (across)` / `Shoulder Width` | Shoulders |
| `½ Width (pit to pit)` | Chest (pit-to-pit) |
| `½ Bottom Width` / `½ Hem` | Bottom Opening |
| `Front Length (from HPS)` | Front Length |
| `½ Waist` · `½ Thigh` · `½ Knee (35 cm)` · `½ Leg Opening` | Waist · Thigh · Knee · Leg |
| `Front Rise (without waistband)` · `Back Rise (without waistband)` | Rise · Backrise |

Values carry across **unchanged** — the pages publish the half-measurement as-is
(Keri's older page labels them `Waist 1/2`, `Thigh 1/2`). Confirmed on Beth,
where all six bottoms rows matched to the decimal. No doubling, no conversion.

This is 4 rows of a 26-row chart for tops, 6 of ~30 for bottoms — which is
exactly why reply point (a) still matters: we are carrying that selection, not
Threadflow.

**Verified against 16 older-season pages** (the plain `<Style> Fitguide` ones,
which predate the flat-chart problem and were written independently of the
charts). Rendering the FW26 table and diffing:

| | Result |
|---|---|
| **Bottoms — proof-grade** | Keri 6 rows × 11 sizes, max diff **0.00–0.50cm**. Miko all six rows **0.00**. Fuller, Barnes, Siren the same bar one row each. The bottoms mapping is correct. |
| **Tops — strongly indicated** | Gillish, Blake, Lima, Deka, Richmond, Dyer agree within ~1cm on most rows — but on 1–4 overlapping sizes each, because the old pages use different size ranges. Evidence, not proof. |

**Five outliers to eyeball before publishing**, where the diff is too large to be
grading drift between seasons: Siren `Rise` (24.8cm), Beth `Backrise` (13.4cm at
one size), Aiden `Chest` and `Bottom Opening` (~13cm — the Aiden page may be
quoting full width where the chart is half), Pull `Bottom Opening` (4cm),
Richmond `Front Length` (9cm at one size). Small diffs (≤1cm) are a spec that
moved between seasons and are expected; these are not.

## 9. Creating the pages: what it takes and what it needs decided

The plan — generate the pages now, link them on push — works, and it needs less
code than it looks.

**The push already carries it.** `push-shopify.ts:85` sends `fitguidePageId` as a
`page_reference` metafield today. Nothing in the push changes. The job is:
build a page body → `pageCreate` on Shopify → store the returned GID on the
colorways → the existing push does the rest.

**No chart storage model is needed for this.** Their §5 three-table proposal is
the right way to hold charts long term, but generating pages needs none of it —
the season JSON plus the §8 row map is enough. Build the tables as a follow-up,
when charts need to be queryable in Origio rather than read once.

**Fan-out: a page is per style, `fitguidePageId` is per colorway.** One
`<Style> FW26 - FitGuide` page attaches to every FW26 colorway of that style.
Joining Threadflow's 74 FW26 styles to the master on `Style.threadflowId`: **all
74 match, covering 165 of the 237 FW26 merchandise colorways.** The other 72 are
Cin7 carry-overs and non-Threadflow styles — they get a page only if their style
also exists in Threadflow's FW26, matched by name. Treat that as a second pass.

### Three things to decide before generating

1. **Prose.** Every existing page opens with fit copy — how the garment sits, when
   to size up — then the table. 40 FW26 styles have an older page to carry that
   from. **34 do not**, and a generated page for those is a bare table. Either
   someone writes them, or those pages ship table-only.

2. **Size labels.** Charts say `2XL`; some existing pages say `XXL`. Use the
   chart's own size names — they are what the values are keyed on — and accept
   the cosmetic change.
3. **Draft or published.** `pageCreate` takes `isPublished`. Creating as drafts
   and publishing once the link is verified avoids orphan pages being crawlable
   before they are attached to anything.
4. **The five outliers in §8.** Worth a human eye before those styles' pages go
   out, in case the old page is right and the chart row is the wrong one.

**This writes to the live storefront.** Page creation is outward-facing and not
trivially reversible at scale, so the scope goes in front of you for confirmation
before anything is created — the same discipline as a Loom push.

## 10. What was done — 2026-09-15

Three pages created and published on Shopify, chosen to cover each code path:

| Page | | Rows used |
|---|---|---|
| `Aiden FW26 - FitGuide` | tops, `Shoulder Width` fallback | Shoulder Width · ½ Width (pit to pit) · ½ Bottom Width · Front Length (from HPS) |
| `Barnes FW26 - FitGuide` | bottoms | ½ Waist · ½ Thigh · ½ Knee (35 cm) · ½ Leg Opening · Front Rise · Back Rise |
| `Lais FW26 - FitGuide` | tops, `½ Hem` fallback | Shoulder (across) · ½ Width (pit to pit) · ½ Hem · Front Length (from HPS) |

Both fallbacks were checked before publishing rather than trusted: Aiden's
`Shoulder Width` is 61–67cm and Western Shirt's 50–58cm — real shoulder
measurements on oversized shirts, not the 5–6.5cm seam widths that the same row
name holds on some SS26 charts. The fallback is sound here; it is worth
re-checking whenever it fires.

Then the remaining 48.

### Result

| | |
|---|---:|
| FW26 fit guide pages live on Shopify | **58** |
| Cells re-verified against the chart *after* publishing | **1,526 — zero mismatches** |
| FW26 colorways carrying `fitguidePageId` | **139** of 237 |
| Master-wide, all seasons (was 1) | **140** |

All published. Pages are `<Style> FW26 - FitGuide`, handle
`<style>-fw26-fitguide`; the body is the mailto line and the table, nothing else.
`push-shopify.ts:85` already sends `fitguidePageId`, so the next FW26 Shopify
push carries the link with no further change.

### Four of the "blocked" styles were never blocked

Building the request file for design surfaced a bug in my own row patterns, not
in the charts. Four styles were fully graded and complete all along:

| Style | Why it was skipped |
|---|---|
| **Fir** (suitpant) | waist row is `½ Waist (straight)`, not plain `½ Waist` |
| **Hayes Straight Suitpant**, **Hayes Wide Suitpant** | leg row is `½ Leg Opening (10 cm up)` |
| **Agra** (skirt) | matched against the tops column set — see below |

Fir and the two Hayes published, taking the total to **54**. The generator now
accepts the qualified row names (but deliberately *not* `½ Waist (Top of WB)`,
which is a different measurement rather than a differently-worded one).

**The column set must key on the chart template and garment, not `size_system`.**
Agra is a skirt on the `Bottom` template with alpha sizes, so `size_system` reads
`tops`; Fir is a suitpant on `Bottom` with EU sizes. `size_system` describes the
size *labels*, not the shape of the garment. Fixed. None of the already-published
pages was affected — every one of them had template and `size_system` agreeing.

### Column sets beyond the original rule

Four more published once the rule was extended past tops and bottoms:

- **Agra** — skirt: Waist · Hip · Bottom Opening · Total Length, following the
  existing Blanche / Heist / Turnip pages.
- **Binou**, **Collum** — scarves: Length (× Width), following Lerke / Hilda.
  Accessories are exempt from the ungraded check — one length at every size is
  correct for a one-size item, not a fault — and the table is trimmed to sizes
  actually sold, or Collum's chart would render six identical lines.
- **Rambler** — a **raglan**, so it has no shoulder seam and no shoulder
  measurement to publish. `Shoulders` is now the one tops column allowed to be
  absent; the page simply omits it, as the Abby / Centi / Mila / Tiki pages
  already do. The other three tops columns stay mandatory, so a chart missing
  one is still a real gap.

That took the ask to design from 18 styles down to **11** — and every one of the
remaining 11 is the *same* problem, `grading_increment: 0`. Ida additionally
needs a `Front Length (from HPS)` row; it has `(from collar)`.

The 98 FW26 colorways still without a page are those 11 styles and the ~72
colorways on styles absent from Threadflow's FW26 feed.

### The two sourced corrections

`Richmond SS26` and `Initial SS26` rewritten from the graded charts — Richmond
from FW26/SS27, Initial from SS27. Only the chest column changed; every other
column was left byte-for-byte.

| | | |
|---|---|---|
| Richmond SS26 | 36.5 · 38.5 · 40.5 · 42.5 · 44.5 | → **48** · 50 · 52 · 54 · 56 |
| Initial SS26 | 39 · 41 · 43 · 45 · 47 · 49 | → 56.5 · 58.5 · 60.5 · 62.5 · 64.5 · **66.5** |

9 of the 11 cells come straight from Threadflow. The two in bold are one grading
step beyond the chart's size range (Richmond's page has an XS, Initial's an
XXXL; both charts run S–2XL) and were extrapolated with the chart's own
increment of 2.

**`Brass Tee SS26` and `Pen SS26` were left alone** — no graded chart in any
season, so correcting them would mean inventing the increment. They wait on the
grading ask.

## 11. Order of work

| # | | Blocked on |
|---|---|---|
| 1 | **Add the reference metafields to `METAFIELD_MAP` and pull the 309 links in** (§4) | Nobody. **Still first** — it is C1's blocker and closes the 106-of-128 blanking hazard, independent of everything above. |
| 2 | Generate and create pages for all **55 ready styles** (14 bottoms, 41 tops) and link them to their 165 colorways | The decisions in §9. |
| 3 | Send Threadflow the §7 asks — grading first | Nobody. |
| 4 | Split the 8 `LIV-HYS-ST-PNT-BLCK` sizes (§6) | Nobody. Small. |
| 5 | The remaining 11 styles | Design filling the charts — `docs/fitguides-fw26-chart-requests.md`. |
| 6 | The 72 non-Threadflow FW26 colorways, and prose for the 34 | A decision on §9.1. |
| 7 | Chart storage model (their §5) | Nothing — but only worth it when Origio needs to query charts, not to ship FW26. |
