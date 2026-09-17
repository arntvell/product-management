# How the Shopify push works — and what to know before pushing FW26

**As of 2026-09-18.** Three bugs were found and **all three are fixed and
verified live** — §1, §1a, §1b. Two had never fired, because the push had not
been run against the products the linker matched (work deck C1). **§1a did
fire**, on the two products pushed while testing.

---

## 1. Fixed: the push would have rebuilt 42 live jeans products

**42 of the 128 FW26 products already on Shopify use a two-option size scheme —
`Waist` × `Length`. The push sends one option, `Size`, with values like
`W24/L32`.**

`productSet` is declarative for list fields: *"Creates new entries, updates
existing entries, and deletes existing entries that aren't included in the
mutation's input."* Variant identity is the **option-value combination**, not the
SKU. So changing the option scheme does not rename anything — it deletes every
existing variant and creates new ones.

Verified on Keri Japan Dawn (`LIV-KR-JPN-DWN`), ACTIVE on the storefront:

| | |
|---|---|
| Live options | `Waist` = 24…31 · `Length` = 32, 34 |
| Live variant | title `24 / 32`, sku `LIV-KR-JPN-DWN-2432`, **24 units** |
| Master would send | `productOptions: [{name: "Size"}]`, value `W24/L32` |

The SKUs match on both sides — that is not the problem. The option *structure*
does not.

**Exposure:**

| | |
|---:|---|
| **42** | FW26 products live with `Waist` × `Length` |
| **723** | variants on them |
| **6,062** | units of stock |
| **37 / 5,761** | of those products ACTIVE, and their units |

Worst by stock: Keri Japan Dawn 433 · Tia Japan Black 371 · Page Japan Indigo
Rinse 366 · Miko Japan Black Dusk 308 · Tia Japan Indigo 306.

What deleting a variant costs: its inventory level, its variant GID (so order
line items and `VariantChannelRef` rows point at something that no longer
exists), and the customer-facing size selector changes from two dropdowns to one
reading "W24/L32".

### The fix

The master already stores `dim1` (waist) and `dim2` (length) separately, so the
push now emits **two** `productOptions` when any variant has a `dim2`, and keys
the variants on both. That matches what is live, so nothing is rebuilt.
`push-shopify.ts`, plus `dim1`/`dim2` carried through `ShopifyPreview`.

It also refuses outright if a 2-D colorway has a variant with a waist but no
length — those would silently collapse onto another variant's option pair.

**Verified live** on `LIV-FLR-CHI-KHA` (Fuller Chino Khaki — DRAFT, zero stock,
2-D, so nothing to lose):

| | Before | After |
|---|---|---|
| Options | `Waist` × `Length` | `Waist` × `Length` — unchanged |
| Variants | 15 | 17 |
| Original variant GIDs | — | **all 15 preserved, none changed, none removed** |
| Added | — | `…-2934`, `…-4034` — genuinely new in the master |

Against all 42: **35 now push with a matching scheme and zero deletions,
5,569 units no longer at risk.** The remaining 7 still drop 12 variants between
them, but **every one carries zero stock** — dead sizes the master no longer
lists, plus three placeholder `28*` / `29*` / `30*` variants with no SKU at all.
One, `LIV-KR-JPN-GRVL-2534`, is at **-1** (an oversell) and deleting it would
hide that.

---

## 1a. Fixed: the push stripped every metafield the master did not hold

**This one actually fired**, on the two products pushed while testing.

`productSet` is declarative for metafields exactly as it is for variants and
files. The push sent only the `custom.*` keys the master had values for, so
**every other metafield on the product was deleted** — including keys the master
has no opinion about and keys it does not own at all.

Abby White went from **17 metafields to 3**, losing `full_description`,
`short_description`, `details`, `care_page`, `model_info`, `same_product`,
`style_with` and more. Fuller Chino Beige, before the fix, would have lost
`judgeme.badge` and `judgeme.widget` — the Judge.me review app's keys, which
carry the product's reviews.

`clearEmptied` was a red herring: it was off, and it correctly reported "left N
field(s) untouched". They were not untouched. `productSet` had already removed
them.

**The fix:** on update, read the live product's metafields and carry every key
the master is not setting into the input, so `productSet` preserves them. The
master overlays the keys it owns; everything else survives untouched.
`clearEmptied` still works — the keys it is clearing are deliberately not
carried back.

**Verified live** on Fuller Chino Beige: 9 metafields before, 14 after, **zero
lost** — both `judgeme.*` keys intact, 5 added from the master.

> This is the rule for the whole mutation: `productSet` replaces every list it is
> given and deletes what is missing. Variants (§1), metafields (here) and files
> all behave the same way. Anything the master is not the authority for has to be
> read and sent back.

---

## 1b. Fixed: the push would have renamed 117 of 128 products

`buildShopifyPreview` set `title: cw.name` — the **colourway** name alone. The
master splits style from colourway; Shopify does not, because there the product
*is* the colourway. So every update rewrote the storefront title:

> "Barnes Japan Dawn" → "Japan Dawn"
> "Kai Japan New Blue" → "Japan New Blue"
> "Nelson White" → "White"

**117 of the 128 FW26 products** were titled `<style> <colourway>` and would have
been cut down to the colourway. This one is worse in reach than §1 and it was
caught only because the §1 test run did it to Fuller Chino Khaki, which was then
restored.

The title is now composed — `shopifyTitle(styleName, colorwayName)` in
`publish.ts` — skipping the style when the name already leads with it, so an
imported "Barnes Japan Dawn" does not become "Barnes Barnes Japan Dawn".

**After the fix, 120 of 128 titles are byte-identical to what is live.** The
remaining 8 are real master-vs-Shopify drift, not a bug, and want a merchandising
decision before those products are pushed:

| SKU | Live on Shopify | Master would send |
|---|---|---|
| `LIV-RCHMND-2-PCK-WHT` | Richmond 2-pack White | Richmond White |
| `LIV-RCHMND-2-PCK-GRML` | Richmond 2-pack Grey Melange | Richmond Grey Melange |
| `LIV-RCHMND-2-PCK-BLCK` | Richmond 2-pack Black | Richmond Black |
| `LIV-HYS-ST-JCKT-SNGL-BRSTD-BLCK` | Hayes Suit Jacket Single Breasted Black | Hayes Suit Jacket Black |
| `LIV-KN-JP-BKNL-S` | Keen Black Noil Silk | Keen Raw Black Noil Silk |
| `LIV-BRNS-JPN-RNS` | Barnes Japan Rinse | Barnes Japan Indigo Rinse |
| `LIV-TK-SLK-BLCK` | Tiki Black Silk | Tiki Silk Black |
| `LIV-TK-WHT-SLK` | Tiki White Silk | Tiki Silk White |

"2-pack" and "Single Breasted" are real information the master does not hold.

---

## 2. What the push does, in order

`pushColorwayToShopify(id, seasonCode, allowIncomplete, clearEmptied)` —
`src/lib/master/push-shopify.ts:130`. The bulk route is
`POST /api/catalog/push/shopify/bulk` with `{colorwayIds, seasonCode,
allowIncomplete, clearEmptied}`, three at a time, one failure never blocking the
rest.

**1 — Load and preview.** `getColorwayForPublish` reads the colorway with style,
brand, variants, prices, media, season images, publications. Passing
`seasonCode` scopes **prices** to that season. `buildShopifyPreview` turns it
into the intended Shopify shape.

**2 — Readiness gate.** Two tiers:

| Absolute — never waivable | Waivable with `allowIncomplete` |
|---|---|
| variants, price | description, image, tags, swatch, care page, fit guide |

A product with no description or photograph is not something to put in front of
a customer, so those are in the gate — but they can be waived deliberately.
Variants and price cannot be waived at all.

**3 — Metafields.** The `custom.*` set: free text (short/full description,
details, tagline, style name), `color_hex`, the reference fields (care page,
fitguide, recommended collection), `model_info` resolved from the model
metaobject into a sentence, and product links (`same_product`, `style_with`, …)
whose master ids are resolved to Shopify GIDs — targets not yet pushed are
skipped.

**4 — Media.** See §3.

**5 — Merge, for updates only.** `productSet` is full-replace, so the live
product is read first and:
- **tags are unioned** — a merchant-added tag is never removed;
- **an ACTIVE product is never downgraded.** If the master says DRAFT but the
  live product is ACTIVE, the status is left alone and you get a warning.
Everything else is replaced by the master's value.

**6 — `productSet`.** One call, `synchronous: true`.

**7 — Cleanup.** With `clearEmptied`, managed `custom.*` keys blank in the master
are deleted from Shopify. **Off by default and it should stay off today** — see
§4.

**8 — Record.** `ChannelPublication` gets `externalId`, `lastPushedAt`,
`lastPushStatus`.

### Status

`Colorway.status` drives it, and FW26 is **228 DRAFT / 9 ACTIVE**. A create lands
as DRAFT — visible in admin, not on the storefront — so creating is low-risk.
Updates are the risky direction, because 128 of them touch live products.

---

## 3. Media

**Only public `http(s)` URLs push.** Threadflow refs are relative paths and are
filtered out with a warning.

Routing depends on `unisex`:

| | Product media | Metafields |
|---|---|---|
| non-unisex | `GALLERY` | `custom.flat` ← FLAT |
| unisex | `FLAT` | `custom.flat`, `custom.men_images` ← MEN, `custom.women_images` ← WOMEN |

Each URL is uploaded once with `fileCreate`, and the returned GID is cached on
`MediaAsset.shopifyMediaId` / `SeasonImage.shopifyFileId` so a re-push reuses it
instead of creating a duplicate file. **That idempotency has never run live** —
every one of the 29 media rows still has a null GID. The first push with images
is the test: push one, re-push it, count the files.

Media is **best-effort** — any failure becomes a warning and the rest of the
product still pushes. The token does have `write_files`, so it should work.

**`files` is declarative too.** Omitted entirely when the master has no pushable
image — so existing Shopify photos survive. But when the master *does* have
media, the list replaces what is on the product. **116 of the 128 live FW26
products have photos today and the master knows about none of them**, so
uploading images to a colorway and pushing replaces the live set rather than
adding to it.

---

## 4. Two flags

**`allowIncomplete`** — waives the merchandising half of the gate. Without it,
only 13 of 237 FW26 colorways pass (see §5).

**`clearEmptied`** — deletes managed `custom.*` keys that are blank in the
master. **Leave it off.** The master is blank for `fitguide` on most colorways
and for `care_page` on nearly all, so ticking it would strip live metafields from
products that have them. Blank in the master means "not written yet", not "erase
what the shop has".

---

## 5. FW26 readiness, field by field

Of **237** merchandise colorways:

| | Have it | Missing |
|---|---:|---:|
| variants | 231 | 6 |
| NOK MSRP price | 232 | 5 |
| description | **97** | **140** |
| tags | 192 | 45 |
| swatch hex | 149 | 88 |
| care page | **70** | **167** |
| fit guide | 139 | 98 |
| image *(as the gate counts it)* | 75 | 162 |

**Fully ready: 13. Orderable (variants + price): 230.**

### The image number is wrong, and it matters

`getColorwayForPublish` includes `seasonImages` **unfiltered by season**, and the
only season images in the database are **504 SS27 Threadflow refs**. So an FW26
colorway passes the `hasImage` gate on an SS27 image that then fails the
public-URL test and never pushes.

**70 FW26 colorways pass the image gate with nothing pushable.** Of the 13
"fully ready", **12 would publish with no photograph at all** — only Barnes
Faded Porcelain (`LIV-BRNS-FDD-PRCLN`) has real media.

Real pushable images across the whole master: **29 files on 6 colorways.**

Two-line fix, alongside the §1 one: scope `seasonImages` by season the way
`prices` already is, and count only public URLs toward `hasImage`.

---

## 6. What is safe to push today

| Push | Count | Safe? |
|---|---:|---|
| **Creates** — no Shopify product yet | **109** | **Yes.** They land as DRAFT, so nothing customer-facing can break. 8 pass the gate as-is; 102 are orderable and need `allowIncomplete`. |
| **Updates, one-dimensional** (tops, knitwear, outerwear) | **86** | Yes on variants — live and master agree on a single `Size` option. They will not gain images. |
| **Updates, two-dimensional** (jeans, trousers, skirts) | **42** | **Yes, now** — §1 is fixed and verified. 35 are byte-clean; the other 7 drop only zero-stock variants. |
| The **8 title-drift products** | 8 | Decide first — §1b. They are inside the counts above. |
| Anything with `clearEmptied` | — | No — §4. |

**All 237 are pushable now**, with `allowIncomplete` on and `clearEmptied` off.

Two things that are still true after the fixes:

- **Almost nothing will gain a photograph.** Only 6 colorways have pushable
  media (§5), so 231 push imageless. The bulk image upload is the next job.
- **The 8 in §1b will be renamed** if pushed as-is.

