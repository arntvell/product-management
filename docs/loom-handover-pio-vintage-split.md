# Handover to Loom — vintage split, and what it means for Pio

**From:** Origio (Livid) · **Date:** 2026-09-17
**Status:** step 1 applied in Origio for one probe colourway. Nothing pushed to
Loom yet. We are holding the push until we understand the Pio side.

---

## 1. What is wrong today

Cin7 writes the size last in a SKU, so our importer stripped the last hyphen
segment and grouped on the rest. For sized garments that is correct. For vintage
it is not, because the last segment is not a size — it is the garment.

The result is that 514 distinct second-hand garments were folded into **18
products**, each garment appearing as a *size* of the first one alphabetically:

- `EXT-VN-NW-USBRSHRT` ("US Heritage Brand Shirt") became **size "USBRSHRT" of a
  product called RUGBY SHIRT**.
- `VN-ONLN` swallowed **391** separate garments as sizes of one Polo Ralph Lauren
  shirt.

This is why these SKUs cannot be found by name in Loom, and why they show up on
the `sitoo-unmatched-skus` queue.

The original model did this deliberately — the code says second-hand items "are
not barcoded individually". That is no longer true: **all 514 have a barcode, and
all 514 barcodes are distinct.** That is exactly why Sitoo carries them as
separate SKUs.

## 2. What we are changing, in Origio

Each garment gets its own Style and Colourway, both named from the Cin7 name.
For vintage, style name and colourway name are the same — one garment, one name,
exactly one of it.

**The variant id never changes.** That is the whole point: this is a *move*, not
a delete-and-recreate, so stock, cost and order history stay on the same row.

Applied already, for the probe colourway `EXT-VN-NW`:

| | before | after |
|---|---|---|
| products | 1 ("RUGBY SHIRT") | 26 |
| variants | 26, as "sizes" | 26, one per product, all `OS` |
| variant ids | — | unchanged |
| barcodes | — | unchanged |
| old colourway | live | empty, archived |

Remaining after the probe: **12 colourways, 454 variants**, same shape.
(`VN-ONLN` 391, `EXT-VN` 19, `VIN` 12, `EXT` 7, `EXT-VN-NW-SLK` 6, `EXT-VIN` 4,
`EXT-VIN-PR` 4, `VN-KNT` 3, `EXT-VN-NW-JHS` 2, `EXT-VN-NW-LLW` 2,
`EXT-VN-NW-LVS` 2, `EXT-VN-PRNT-SHRT` 2.)

Out of scope: `EXT-VN-LVSN-BL` and `EXT-VN-LVSN-BK` (Levis Blue/Black) are
genuine size runs and stay as they are. The five `VPACK25-*` colourways are
legacy and are being left alone.

## 3. The Pio question — this is what we need from you

Our note from you says **Pio cannot re-group**: its product id is immutable, a
moved SKU gets a 409, and you block the push and list the SKUs in
`pioReparentPending`.

**Our concern, and the reason we are asking before pushing the other 454:**

> These 26 garments must appear in Pio as **26 separate products**. If they stay
> nested under one Pio product as sizes/variants — a blazer, a tote bag, belts
> and a rugby shirt all as "sizes" of RUGBY SHIRT — picking is going to be very
> confusing for warehouse staff. A picker sent for "RUGBY SHIRT, size BLZR" is
> being asked for a blazer.

So the questions:

1. **What actually happens in Pio when we push this?** Do we get
   `pioReparentPending` for all 26, or does Pio accept them as new products?
2. **If Pio blocks the regroup, what is the path?** Does the warehouse need to
   retire the old Pio product and take the 26 in as new ones — and if so, does
   that lose stock or location history we care about?
3. **Who names the Pio product?** We are sending the real garment name per SKU
   (table below). Does Pio take its name from the Loom product, and will the 26
   names land, or does the old "RUGBY SHIRT" grouping and name stick on their
   side regardless of what we send?
4. **Order of operations.** Our understanding is withdrawals go in the same batch
   as the moves or after, never before, because archiving cascades to
   `retireProduct` and issues real DELETEs to Pio for anything at zero stock. Is
   a same-batch push still the right shape here, or would you rather have the 26
   new products land and settle first, and take the withdrawal separately?
5. **Sequencing the rest.** If the probe works, we would do the remaining 12
   parents one at a time. `VN-ONLN` alone is 391 garments — is that a size of
   batch Pio can absorb, or should it be chunked?

## 4. What we will send

One push, `mode: data`, season `CONTINUITY` (your `archv`), containing the 26 new
colourways **and** the withdrawal of `EXT-VN-NW`, with
`allow_variant_reparent: true` and an explicit `sku` per variant.

We expect `variantsMoved: 26`, `variantsCreated: 0`. Anything in
`variantsCreated` would mean the stable ids were not recognised and duplicates
were made instead of moves — we would stop there.

**Also for your `GET /styles?empty=true` sweep:** style
`11a7cf1c-b180-459f-ba3c-ced8606d0c6f` (`EXT-VN-NW`, "RUGBY SHIRT") is now a
zero-colourway shell on your side.

## 5. The 26, with the names we want in Pio

| SKU | was (a "size" of RUGBY SHIRT) | should be its own product | barcode | variant_id |
|---|---|---|---|---|
| `EXT-VN-NW-BLS` | `BLS` | BLOUSE | 7000000010385 | `b514411b-669c-4fdf-ac6d-a7c852abc3af` |
| `EXT-VN-NW-BLTS` | `BLTS` | BELTS | 7000000010361 | `2d4f6ffc-ce9d-4c92-b24a-a0edeb921e93` |
| `EXT-VN-NW-BLZR` | `BLZR` | BLAZER | 7000000010378 | `7f93f606-79bc-40dd-ab0a-6ccb119cac5b` |
| `EXT-VN-NW-BNDT` | `BNDT` | Rock Tee | 7000000010354 | `e4605dcc-d64a-44d1-a85b-63c7e45873c3` |
| `EXT-VN-NW-BRDNFLC` | `BRDNFLC` | Fleece | 7000000010392 | `3d473260-44d0-4c80-acaa-1751e5654fa8` |
| `EXT-VN-NW-BRNCL` | `BRNCL` | BRANDED COLLEGE | 7000000010408 | `001372ae-970c-4d26-9494-579c8a66e75b` |
| `EXT-VN-NW-BRNDJK` | `BRNDJK` | BRANDED DENIM JACKET | 7000000010415 | `79c499fd-1be2-4a72-9540-b65cb0bb3f7a` |
| `EXT-VN-NW-BTDSR` | `BTDSR` | Summer Skirt | 7000000015120 | `be2df713-21a8-407d-b477-108c1e425142` |
| `EXT-VN-NW-BUDDRS` | `BUDDRS` | BUTTON UP DENIM DRESS | 7000000010460 | `91afc32e-6a47-4769-ac78-8120d4fe6ca6` |
| `EXT-VN-NW-BUDRS` | `BUDRS` | BUTTON UP SUMMER DRESS | 7000000010484 | `971893ac-0986-4803-916a-a410d98b40aa` |
| `EXT-VN-NW-DKSPNT` | `DKSPNT` | DICKIES PANT | 7000000010514 | `a5469dca-3230-44b8-9442-21736869583b` |
| `EXT-VN-NW-DNGRS` | `DNGRS` | DUNGAREES | 7000000010521 | `5d26f8dd-9529-460d-b0ac-ce8e63afb2c3` |
| `EXT-VN-NW-HWII` | `HWII` | HAWAIIAN SHIRT | 7000000010552 | `a9f5ab6c-8d1a-4585-93c7-6f2b73ab442d` |
| `EXT-VN-NW-HWP` | `HWP` | HIGH WAIST PANT | 7000000010569 | `560ec2c6-3120-41d9-9f81-3fb584219384` |
| `EXT-VN-NW-HWSL` | `HWSL` | HIGH WAIST SHORT | 7000000010576 | `fe976877-28bc-4435-b758-40b6fb7ca6fa` |
| `EXT-VN-NW-INCA` | `INCA` | INCA PRINT HEAVY SHIRT | 7000000010590 | `424723ff-85e4-43d9-8660-cc66d29c7053` |
| `EXT-VN-NW-PLNCL` | `PLNCL` | PLAIN COLLEGE | 7000000010835 | `c3a68b04-6c6b-4c74-aa4d-5732d93ded1c` |
| `EXT-VN-NW-PRNTCL` | `PRNTCL` | PRINT COLLEGE | 7000000010873 | `9ab6d676-0782-4f9d-b102-64b347335c02` |
| `EXT-VN-NW-RGBY` | `RGBY` | RUGBY SHIRT | 7000000010927 | `d251b193-cdf8-4d8d-811a-fc2db05d86f5` |
| `EXT-VN-NW-RMNTCBL` | `RMNTCBL` | ROMANTIC BLOUSE | 7000000010910 | `a53b0469-0237-45df-808b-f6125fc02c07` |
| `EXT-VN-NW-SEDBMB` | `SEDBMB` | SUEDE BOMBER | 7000000009648 | `3cbc3dad-a126-4cd3-ab4e-ede102f2fec0` |
| `EXT-VN-NW-STRPS` | `STRPS` | STRIPE SHIRT | 7000000011016 | `68260775-af20-43cd-928a-6689a69e41c9` |
| `EXT-VN-NW-TBG` | `TBG` | TOTE BAG | 7000000010453 | `f3f0b2b6-5ffa-4247-baa7-2b0be98c8bd0` |
| `EXT-VN-NW-TRDKNT` | `TRDKNT` | TRADITIONAL KNIT | 7000000011030 | `021b86a7-d3bb-4a2d-b960-a702d15c00eb` |
| `EXT-VN-NW-USBRSHRT` | `USBRSHRT` | US Heritage Brand Shirt | 7000000011085 | `57a29f1a-5160-4e42-b149-48c67e6e8a3e` |
| `EXT-VN-NW-WRKJK` | `WRKJK` | WORKER JACKET | 7000000011078 | `5aa45512-f97c-4ae5-a51c-127755f680b1` |

The variant ids above are the ones already in Loom — `57a29f1a-…` is the row you
currently hold under RUGBY SHIRT. They do not change. Only the colourway each one
hangs from changes.
