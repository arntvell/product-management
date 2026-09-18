# Channel membership — what Origio knows, what Loom was told, what is left

Answer to `loom-channel-membership-handover.md` (2026-09-18) and to the question
behind it: do we actually control which products are in Shopify, in Sitoo and in
Loom? Measured against the live database and the production Sitoo catalogue on
2026-09-18.

---

## 1. Short answer

Yes for Shopify. Yes for Sitoo, but the fact was never written down anywhere Loom
could read it. And there is a large part of the Sitoo catalogue Origio does not
know about at all, which no flag can cover.

| | colorways |
|---|---|
| Shopify only | 1 620 |
| Sitoo only | 1 479 |
| both (the ones whose stock genuinely has to sync) | 786 |
| neither — Loom-only | 1 202 |
| **total** | **5 087** |

That is the distribution Loom's stock page could not see. Only 786 colorways need
a Sitoo⇄Shopify stock link at all; it was treating all of them as if they did,
which is where the ~2 000 `no_inventory_item` failures come from.

## 2. Origio knew Sitoo membership all along and never declared it

Membership lives in two places. `VariantChannelRef` is *evidence* — a link minted
by a linker that matched a garment to the product representing it in a channel.
`ChannelPublication` is the *declaration* — presence means "targeted at this
channel", and it is what the Loom feed reads.

The Shopify linker writes its own publication rows, so Shopify agreed with
itself: **2 406 colorways linked, 2 406 declared, zero linked without a row.**

The Sitoo linker never did. **8 089 variant links across 2 265 colorways, and
zero `ChannelPublication(SITOO)` rows in the entire database.** The `Channel` enum
has had `SITOO` since the cutover and `PUBLISH_CHANNELS` lists it, but no code
path ever created one and no UI ever offered one. So the payload had no `sitoo`
key to send, and Loom kept guessing.

## 3. What changed in the code

- **`loom/payload.ts`** — the `channels` block is built once by `channelsFor()`
  and now carries `{ loom, shopify, sitoo }`. The registry and catalogue builders
  had two independent copies of it; that is how `shopify` came to be hardcoded
  `false` in one of them and went out wrong for 81 products.
- **`master/channel-membership.ts`** (new) — turns link evidence into declared
  membership. **Additive only.** It never withdraws a product from a channel,
  because `sitoo: false` tells Loom to *suppress* that product's stock errors, and
  inferring a withdrawal from a linker run that read a partial catalogue would
  silence live garments and look like an improvement. Loom applies the same rule
  to its own inference. `declaredWithoutLink` is reported for a person to judge.
- **`sitoo/link.ts`** — runs the membership sync at the end of every run, so a
  garment added to Sitoo tomorrow declares itself without anyone remembering to.
- **`push-orchestrator.ts`** — channels are declared when the batch is *created*,
  not when each phase runs. `PHASES` is SHOPIFY → LOOM → SITOO, so a batch
  creating a product in both would have told Loom `sitoo: false` for a garment it
  was about to put in five stores. If the Sitoo phase then fails, `sitoo: true`
  with no link is exactly the `channel_declared_absent` state Loom asked to be
  able to raise — a real gap, correctly reported.
- **`colorways/[id]/channels`** — now **absent-means-keep**. It deleted any
  channel not explicitly `true`, so adding SITOO to its list would have made every
  toggle in the colorway panel (which sends SHOPIFY and LOOM only) silently
  withdraw the product from Sitoo. Same rule Loom applies to us, for the same
  reason.
- **Publishing table + channels panel** — a Sitoo column, target/untarget, and a
  count of how many products are in both storefront channels. This is the
  per-season view: `listColorwaysForPublishing(seasonCode)` was already
  season-scoped.
- **`channels/reconcile`** (new route) — the one-time backfill, idempotent.

## 4. Two hazards found on the way

**The Sitoo linker followed `SITOO_TARGET`, which is `sandbox` in dev.** A dry run
read 565 sandbox products and proposed **re-pointing 93 production links** to
sandbox ids, plus 14 704 variants reported unmatched against a database holding
8 089 good links. Run live it would have aimed 93 garments at ids that do not
exist in production, and it would have surfaced at a till. The linker now refuses
to write from a sandbox read unless asked explicitly, and takes `target`.

**`unmatchedSitoo` was only correct on the first ever run.** It counted products
matched *fresh*, so every already-linked garment read as unmatched: 14 713 of
14 714. This is the figure that answers how much of the POS catalogue is outside
the master, so being wrong by a factor of two mattered. Fixed.

## 5. The part no flag can fix

Against production Sitoo, 2026-09-18:

| | |
|---|---|
| Sitoo products total | 14 714 |
| accounted for by an Origio variant | 8 016 |
| **Sitoo products Origio has never seen** | **6 698** |
| Origio variants with no Sitoo product | 6 786 |
| existing links still valid (`repointed: 0`) | 8 015 |

**6 698 products — 46% of the POS catalogue — have no Origio record.** Origio
cannot flag them, cannot send them to Loom and cannot hold an opinion about their
channels.

**They do not block any of this**, and it is worth being exact about why: a
product Origio has no record of never enters the feed in any form, so we assert
nothing about it, no `false` is sent, and Loom's own catalogue-sweep inference
(§3 of the handover) keeps covering it. They are also not the source of the
`no_inventory_item` failures, which are about variants Loom already holds.

**The "legacy, no longer stocked" reading is only half right.** Checked against
production on 2026-09-18: all 6 697 are `activepos: true`, and **2 818 of them are
`active: true`** — against 6 265 of 8 017 for the products Origio does know. The
unmatched set is not obviously more retired than the matched one. The names are
not old Livid either: `GH-LAYTON-KILTIE-*`, `GH-WMN-PENNY-*` (Grenson),
`EXT-PNT-YS1026-*`, `GFTCRD`. They look like externals and gift cards that were
never brought into the master, not carry-over that aged out.

Actual stock is NOT verified: `lib/sitoo/client.ts` has no stock endpoint, so
`active` is the closest available proxy and it is a weaker claim. If it matters
whether any of those 2 818 hold store stock, that needs a Sitoo stock read we do
not currently have — and if any do, they are invisible to the Origio⇄Loom
pipeline end to end, which is a separate gap from anything the channel flags fix.

The existing links are healthy: `repointed: 0`, 8 015 already valid.

**Checked before declaring anything absent.** After the backfill, 2 822 colorways
go out as `sitoo: false`, and that is only as true as the linker's match. The
linker keys on SKU then barcode, and 4 295 Origio variants have no barcode — so a
garment whose Sitoo SKU is a renamed spelling (the `LIV-KRI-DWN` vs
`LIV-KR-JPN-DWN` case) would match on neither key and be declared absent while
sitting on a shelf. Testing it: strip the size segment from each of the 6 697
unmatched Sitoo SKUs and look for an Origio `colorwaySku` that would go out
`false`. **Ten colorways, and all ten are stem artefacts** — `EXT`, `VIN`,
`EXT-VN` are themselves colorway SKUs, so every `EXT-*` product in Sitoo stems
onto them. No genuine rename collisions. The `false`s are safe to send.

## 5b. How well does Origio know, given it has never pushed to Sitoo?

The knowledge is entirely *matched*, not *asserted* — no product here was ever
pushed to Sitoo from Origio. So the question is how good a completed sweep of
14 714 production products by SKU and then barcode actually is. Per colorway:

| | colorways | |
|---|---|---|
| **in Sitoo** — matched to a live product id | **2 265** | `repointed: 0`, ids still resolve to the same SKU |
| **not in Sitoo** — searched on SKU *and* barcode | **2 182** | strong negative; the standard Loom uses for its own inference |
| **not in Sitoo** — SKU only, no barcode anywhere | **591** | one key only; a renamed SKU would be missed |
| **unknowable** — no variants at all | **49** | nothing to match on |

So **4 447 of 5 087 (87%) is solid**, in both directions. Coverage inside a
matched colorway is clean too: 2 249 have every barcoded variant linked, only 10
are partial.

**The 591 were tested, and they hold.** Taking each one's `colorwaySku` and
looking for it as the stem of any of the 6 697 unmatched Sitoo SKUs: **zero
hits.** (Testing their variant SKUs for an exact match is circular — the linker
already keys on exactly that — so the stem test is the informative one.) Nothing
suggests these are in Sitoo under another spelling. They can be declared
`sitoo: false` with the same confidence as the 2 182.

The residue is the **49 colorways with no variants**, which are empty shells the
feed has nothing to say about anyway.

## 6. What still needs a decision — production writes, not yet run

> **Resolved 2026-09-18 — recorded because it applies again to any new channel
> key.** The feed emits a channel key as soon as the code ships, and reads `false`
> until the declarations exist. The flags ride on EVERY Loom push, not only a
> deliberate membership one, so a single unrelated push in that window would have
> declared 2 265 stocked garments as not sold in Sitoo and silently switched off
> their stock error reporting — the handover's §2 failure mode. Declare first,
> push second.

1. ~~**Backfill the declarations.**~~ **DONE 2026-09-18.**
   `POST /api/catalog/channels/reconcile` created **2 265
   `ChannelPublication(SITOO)` rows**, 0 for Shopify (already consistent).
   ChannelPublication went 7 482 -> 9 747 rows; SHOPIFY (2 408) and LOOM (5 074)
   untouched, nothing modified or deleted. A second run reports `created: 0`.
   Verified end to end: the three colorways that read `{"loom": true, "shopify":
   true, "sitoo": false}` in a dry run before now read `"sitoo": true`.
   Two Shopify colorways are declared without a link — left alone, they need a
   person, not a sweep.
2. **Run the Sitoo linker live against production** to pick up the 1 new match —
   `{"target":"production"}`, never the default.
3. **Push membership to Loom.** The existing `mode: "data"` registry push already
   carries the `channels` block, so no new payload shape is needed; it is a
   superset of the `colorway_sku` + `channels` Loom asked for. Nothing has to be
   omitted: `pushColorwaysToLoom` derives `loom` from `cw.archived` exactly as
   every data push already has.

   **Per season, and chunked.** A colorway not in the pushed `seasonCode` is
   skipped, so this is three runs: CONTINUITY (4 429), SS27 (573), FW26 (239).
   CONTINUITY will not go in one call — the route's `maxDuration` is 300 s — so
   drive it through the batch orchestrator or in chunks, not as a single
   `/push/loom`. Read `job.itemErrors` and the counters, never `ok` alone; verify
   against `GET /api/origio/v1/products`, not `lastPushedAt`, which a chunk that
   returns 502 leaves unstamped even when it landed. Rate limit is 240/min shared
   with `/upsert`, and the read-back counts against it.

## 7. Answers to Loom's open questions

**§6.3 — is "published to Shopify" answerable per colourway?** Yes. Per-colorway
is correct and no migration is needed. Of colorways with barcoded variants, only
**23 have partial Shopify coverage and 10 partial Sitoo coverage** — and those are
missing sizes, not policy. Everything else is all-or-nothing.

**§7 — is `sitoo` meaningful to us?** Yes. Keep asking for it. It is
`ChannelPublication(SITOO)` row presence, not a synthesised field.

**§7 — do we hold a "webshop / store only / both" attribute under another name?**
Not as an attribute. It is the `ChannelPublication` rows, which is the same
question asked per channel rather than as one enum. Reading those is what you are
now getting.

**On the third state.** We send `shopify` and `sitoo` as explicit booleans for the
whole catalogue, so the `null`s clear. We are not sending `false` for "unknown":
after the backfill, absence of a row means the master has been told the product is
not in that channel, which is the declaration you asked for — with the one
exception in §5, the 6 698 Sitoo products that have no Origio record at all. Those
never appear in our feed in any form, so we assert nothing about them.

## 8. One thing we cannot give you: membership per season

The request behind this was per-season visibility, and neither schema has it.
`ChannelPublication` is keyed `(colorwayId, channel)` with no season, and Loom
stores the flags at colorway level too. It is also mostly moot in our data: **4 429
of 5 087 colorways are CONTINUITY**, against 573 SS27 and 239 FW26. A product
carried across seasons is in Sitoo or it is not.

What *is* per-season is the view — the publishing table filters by season and now
shows all three channels — and the push, which is per-season already. If
membership genuinely needs to differ between seasons for the same colorway, say
so, because that is a migration on both sides.
