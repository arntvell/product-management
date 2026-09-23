# Red Wing — the "Shoe Brush" split (EXT-RW)

2026-09-22. Cin7 snapshot: `snapshots/cin7_products.json`, 2026-09-17.

## Scope: one colourway, not the EXT-RW range

The request was to split the variants nested under `EXT-RW-*` the way the
vintage products were split. **That applies to exactly one colourway.**

`EXT-RW` ("Shoe Brush", colourway `b6a6f842…`, style `461fa07b…`) carries 14
variants whose "sizes" are `91025, 97098, 97104, 97106, 97107, 97108, 97135,
97150, 97157, 97158, 97191, 97195, 98002, MNKOIL`. Those are not sizes. They are
14 separate Red Wing care articles — Mink Oil, Leather Protector, four different
laces, a cleaner kit. It is the vintage defect verbatim: Cin7 puts the size last,
the importer stripped the trailing segment and grouped on the rest, and here the
trailing segment is the article, not a size. The parent took its name *and* its
119 kr price from `EXT-RW-97106`, which is the real Shoe Brush.

**Every other `EXT-RW-*` colourway is a genuine US size run (8 – 11.5) and is out
of scope.** `EXT-RW-8085` really is the Iron Ranger in six sizes. Splitting one
would destroy a correct product. The plan script names the parent explicitly and
pins its id; nothing globs `EXT-RW-*`.

## What is wrong today, in Loom

`POST /identity` on the 14 SKUs and 14 barcodes, 2026-09-22: **all 28 keys
resolve**, every one to a variant under colourway `EXT-RW` "Shoe Brush", and the
variant names in Loom are the bare numbers — `91025`, `97098`, `MNKOIL`. So Mink
Oil is in Loom right now as *Shoe Brush, size MNKOIL*. That is why searching Loom
for it finds nothing. None of the 14 is claimed as a colourway, so nothing blocks
the push.

## The plan

`node scripts/rw-split/plan.mjs` → `snapshots/rw-split-plan.json`.

| | |
|---|---|
| variants moved | 14 |
| new styles / colourways | 14 / 14 |
| old colourways withdrawn | 1 (`EXT-RW`) |
| with a name from Cin7 | 14 |
| with a price from Cin7 | 14 (69 – 199 kr) |
| barcodes, all distinct | 14 |
| SKU collisions | 0 |
| brand corrections | 0 |

The names come from Cin7, which carries each of the 14 as its own product. A
variant Cin7 does not know is left under the parent rather than given an invented
name — none hit that here.

`sizeLabel`/`dim1` → `OS`, `dim2` → null: a bottle of mink oil is one size.
Brand, `productType` ("Care") and `vendor` ("Red Wing") are already right on the
parent and are carried over — unlike vintage's `EXT` junk drawer, there is no
brand mistake to avoid inheriting. Each new colourway gets a CONTINUITY entry and
its own Cin7 retail price; the parent's single 119 was right for the Shoe Brush
and wrong for the other 13.

`countryOfOrigin` is carried from Cin7 as-is, which reads "France" on all 14.
That looks like a Cin7 data error for Red Wing care, but it is Cin7's own value
and is not corrected here.

**The variant id never changes**, which is what makes this a move rather than a
delete-and-recreate, and what lets Loom follow the stock across. Each variant
already carries its own Sitoo and Shopify channel refs, keyed on the variant —
those travel with it untouched. 8 of the 14 carry a live Shopify
`ProductVariant` ref; that path is not new, the vintage split moved **50**
Shopify-linked variants and they are still linked.

## Running it

The applier and pusher are the vintage ones, reused via a new `--plan=` flag
rather than forked (default paths unchanged, so vintage still runs as before).

```
node scripts/rw-split/plan.mjs                                    # read-only
node scripts/vintage-split/apply.mjs --plan=snapshots/rw-split-plan.json
node scripts/vintage-split/apply.mjs --plan=snapshots/rw-split-plan.json --apply
node scripts/vintage-split/push.mjs  --plan=snapshots/rw-split-plan.json --parent=EXT-RW
```

`push.mjs` POSTs to the dev server on :3000 — confirm it is the **builder**
checkout before pushing (`lsof -i :3000 -sTCP:LISTEN -P`, then `lsof -a -p <pid>
-d cwd`). The `-main` copy's push route ignores `mode` and would run the whole
push as the wholesale catalogue. Checked 2026-09-22: pid 40001,
`/Users/kristoffer/product-management-builder`. Correct.

Dry run 2026-09-22: `moved 14/14, parent archived`, 14 styles, 14 colourways,
14 entries, 14 prices, 0 skipped. The push sends the 14 new colourways **and**
the withdrawal of `EXT-RW` in one job, `mode: "data"`, with
`allow_variant_reparent`. Expect `variantsMoved: 14`, `variantsCreated: 0`.
Branch on `itemErrors` only — `summary.warnings[]` carries the Pio lines and must
never fail the push.

Style `461fa07b…` holds only this one colourway, so it becomes an empty shell in
Loom once withdrawn — the known open item in `loom-split-styles-answer.md`, not
new here.

## Two adjacent defects found, NOT fixed here

Both are real, both are a different operation from this split, and neither was
asked for. Flagging rather than acting.

**1. Colourway names carry a per-size article number.** Red Wing numbers every
size separately, and Cin7 puts that number in the product name. The colourway
took the name of whichever variant sorted first:

| colourway SKU | named | but its sizes run |
|---|---|---|
| `EXT-RW-2949` | "2952 Roughneck Oil Slick Black" | 2949 (size 8) … 2957 (size 12) |
| `EXT-RW-8836` | "8841 Classic Moc Chocolate Muleskinner" | 8836 (size 8) … 8844 (size 12) |

So `EXT-RW-2949` is displayed as "2952", which is the 9.5. Whether these should
read "2949 Roughneck…" (the SKU base) or just "Roughneck Oil Slick Black" (no
number) is a naming call, not a data fix.

**2. Norway Moc Oro Russet is the inverse defect — it needs a merge, not a
split.** Cin7 put the per-size article number in the *SKU base*
(`EXT-RW-8212-8.5`, `EXT-RW-8213-9`, …), so the same grouping rule shattered one
boot into **7 single-variant colourways** (`EXT-RW-8212` … `8218`, sizes 8.5 –
11.5), all identically named "Norway Moc Oro Russet". They already sit under one
style, so Loom nests them, but each is a separate colourway = a separate colour
of the boot. The fix is to merge 7 variants into one colourway — a re-parent in
the other direction. Cin7 also shows `8210` (7.5), `8211` (8) and `8219` (12),
which Origio does not hold.

## STATE 2026-09-22: DONE — applied in Origio and pushed to Loom

**Done.** `apply.mjs --apply` ran clean: `moved 14/14, parent archived`, 14
styles, 14 colourways, 14 CONTINUITY entries, 14 prices, 0 skipped. Verified in
the database — `EXT-RW` holds 0 variants and is archived; each of the 14 new
colourways has its own style, its Cin7 name and price, `sizeLabel` `OS`, one
CONTINUITY link and its channel refs intact. The 10 boot colourways are
untouched.

**Was blocked before the push: the 14 had no `ChannelPublication` rows.**
Resolved — Kristoffer ran the reconcile, `created: 9` SHOPIFY + `14` SITOO.

`VariantChannelRef` is evidence; `ChannelPublication` is the declaration, and the
Loom payload reads row presence. The split carried the evidence across with the
variant ids, but the applier mints colourways without publication rows — it
predates the 2026-09-18 membership backfill and nothing in it declares a channel.
So the dry-run payload sends all 14 as `"sitoo": false, "shopify": false` while
every one of them is live in Sitoo (all 14) and 9 are live in Shopify. **Loom
suppresses stock errors for a channel declared false**, and the flags ride on
every push, not just a membership one. Pushing in this state would quietly
misdeclare 23 channel memberships.

Both fixes agree on the number — 23 rows, 14 SITOO + 9 SHOPIFY:

```
curl -X POST localhost:3000/api/catalog/channels/reconcile -d '{"dryRun":true}'
  -> SHOPIFY created 9, SITOO created 14
node scripts/rw-split/declare-channels.mjs        # scoped to this split, same 23
```

Run **one** of these, then push:

```
# PREFERRED — the global sweep. Additive, idempotent, and it ran live on
# 2026-09-18, so this exact code path is proven. Its dry run today reports
# created 9 + 14 and nothing else, so in effect it is already scoped to this
# split's 23 rows.
curl -X POST localhost:3000/api/catalog/channels/reconcile -H 'Content-Type: application/json' -d '{}'

# Alternative, scoped to this split. NOTE its INSERT has never executed — the
# write branch was refused before it ran, so only its read half is proven.
node scripts/rw-split/declare-channels.mjs --apply

# Then confirm the fix took before pushing live: the 14 must read "sitoo": true
# (and the 9 "shopify": true) in the dry-run payload.
node scripts/vintage-split/push.mjs --plan=snapshots/rw-split-plan.json --parent=EXT-RW --dry-run

node scripts/vintage-split/push.mjs --plan=snapshots/rw-split-plan.json --parent=EXT-RW
```

Both writes were refused by the auto-mode permission classifier
("Modify Shared Resources") on 2026-09-22, so they need Kristoffer to run them or
to allow the action. The dry runs above are the proof of what they do.

`declaredWithoutLink` names the old `EXT-RW` parent (`b6a6f842…`): it is declared
on both channels and now has no variants. That is correct and expected — it is
being withdrawn. The reconcile is additive only and will not remove it, and the
push sends it `channels.loom = false`.

**Push pre-flight, already verified and still good:** dev server on :3000 is the
builder checkout (pid 40001); `/identity` resolves 14/14 SKUs and 14/14 barcodes,
all under `EXT-RW`, none claimed as a colourway. Dry-run payload confirmed
`season: "archv"`, `mode: "data"`, `allow_variant_reparent: true`, an explicit
`sku` on every variant, and the `EXT-RW` withdrawal (`loom: false`,
`variants: []`) **last** in the batch. Expect `variantsMoved: 14`,
`variantsCreated: 0`; branch on `itemErrors` only.

### Push result

`rw-split-EXT-RW-1790067713195`, job `cmucg3lic0f5sgq0fe8hli86o`, 16 s,
`sent 15/15`:

```
status done, moved 14, created 0, refused 0, itemErrors 0
colourways 15/15, variants 14, prices 15, errors 0
```

Exactly the expected shape: every variant **moved**, none created, so Loom
followed the stock across rather than minting new rows.

`pioReparentPending` lists all 14 with the `renamed_only` warning — Pio took each
product's name and size but would not move the non-null `ext_product_id`. That is
the known, documented outcome (proven on 89 garments during the vintage split):
**picking is correct**, the rows just carry a stale grouping id, retried on each
product sync. It is a `summary.warnings[]` entry, not an `itemError`, and must
not be read as a failure.

Read-back via `POST /identity`, 2026-09-22: **14/14** now resolve to their own
colourway under their own name — `EXT-RW-MNKOIL` → colourway `EXT-RW-MNKOIL`
"Mink Oil", variant "OS". Before the push the same call returned every one of
them as a variant named `MNKOIL`, `97098`… under colourway `EXT-RW` "Shoe Brush".

Channel declarations verified in the dry-run payload before sending: all 14
`sitoo: true`, the 9 Shopify-linked ones `shopify: true`, the other 5 correctly
`false`.
