# The product builder

Built 2026-09-16 on branch `product-builder`. Covers roadmap §5.1 (the shared
spine) and §5.3 (the external-brand builder). The Livid builder (§5.2) and the
vintage builder (§5.4) are untouched; vintage is still gated on access control.

Scope: **external brands only.** Livid product comes through the Threadflow feed
and is excluded from the brand picker.

---

## What it replaces

`buildProductsForBrand` took a free-typed SKU, created **one Style per product
row** (so `styleSku === colorwaySku` and colourways never nested under a style),
forced everything into `CONTINUITY`, collected only a NOK MSRP, wrote six
un-transactioned `createMany` calls, recorded `ChannelPublication` rows with
`published: false` and pushed nowhere. It could not produce a 2-D variant, had no
barcode field, and lost everything on navigation.

It is still on disk and still reachable; delete it once the new path has been
used against production data for a while.

---

## The flow

`/catalog/products/new` creates a draft and redirects — the row exists before the
first keystroke, so there is no unsaved state to lose. Seven steps, a rail rather
than a gate:

1. **Brand & season** — any existing season including CONTINUITY. `ProductKind`
   set here rather than inferred, and **locked**, because `classifyKind` reads
   `EXT-VN-*` as AGGREGATE and would otherwise flip an individual vintage garment
   back days later.
2. **Style** — searches that brand's styles **across all seasons**; a carry-over
   is the same style. Picking one inherits its SKU verbatim and its customs block.
3. **Colourways** — shows what the style already has, so a duplicate name is
   visible before it collides as a SKU. Paste a list, one per line.
4. **Sizes** — from a size system, in the system's order. "Use the first
   colourway's sizes for all" copies sizes and never barcodes.
5. **Prices** — COST and MSRP in NOK, season-scoped, fill-down.
6. **Barcodes** — optional, blank by default. Paste, or export/import a CSV.
7. **Review** — pre-flight against the saved draft, then create.

Autosave is a compare-and-swap on a revision counter: two tabs cannot clobber
each other, and the loser is told rather than winning by being last.

---

## Invariants worth not breaking

**`variantSku === colorwaySku + "-" + skuToken`.** Relied on by `pio.ts` (stem
derivation), `cin7/import.ts` (base/size split) and `normalize-size-labels.ts`.
A disambiguating suffix therefore goes on the colourway, before the size.

**2-D sizes are four digits** (`-3234`, not `-W32-L32`). `deriveSize` in both
`threadflow/sync.ts` and `cin7/import.ts` tests `/^\d{4}$/` on the trailing token,
and `parseSku` reads `\d{4}` as a size. The other spelling would make every new
2-D garment invisible to duplicate detection and to both importers.

**An existing style's SKU is never re-derived** (roadmap 2.2). That is why
`buildColorwaySku` takes the styleSku as a string rather than rebuilding it, and
why `Brand.skuToken` exists: 40 of 51 external brands write something the
abbreviation rule would not produce.

**Sizes are archived, never deleted.** A `SizeSystemEntry` is the record of what
a run once was, and a retired size still has order history behind it.

**A merge is a tombstone.** Categories and brands both keep the loser's row
pointing at the survivor — the `merge-colorways.ts` posture, which is why its 21
merges can still be explained.

**Category is dual-written.** `categoryId` is authoritative for product created
here; the free-text `Style.category` / `Colorway.productType` columns keep being
written so every existing consumer works unchanged. Outbound, the mapping wins
and the text is the fallback: `loomCategoryFor(categoryRef, text)` and
`categoryRef.shopifyProductType ?? text` in the Shopify preview. That is what
lets the ~4,500 text-only rows stay exactly as they are.

**A brand default fills, it never overwrites.** Selecting a brand merges its
`BrandTemplate` into the draft — empty fields only, because a typed value was
meant. Channels are the exception: a configured set replaces the default set,
since a set has no "empty field" to fill.

---

## Creating is not publishing

Finalize writes the master in **one transaction** and nothing else. The channel
push is a separate, retryable step, so the product exists whether or not a
channel is reachable.

The `DRAFT -> FINALIZING` claim is a single conditional UPDATE — the mutex. A
double-clicked button, a retried fetch and two open tabs collapse into one
winner. Ids are reserved at the claim, so a crash resumes by probing a reserved
id: present means the transaction committed and the process died before the
status update; absent means it rolled back and the same ids can be reused.

### Push order: Shopify → Loom → Sitoo

Loom's stock registry joins on Shopify's **InventoryItem** gid, which does not
exist until the product is in Shopify. A Loom item whose Shopify push has not
succeeded is BLOCKED rather than sent carrying nulls.

`PushBatchItem` is the queue, because there is no job runner, `maxDuration` is
300s and `waitForLoomJob` budgets 600s. Every invocation takes a time budget,
persists, and returns `done: false` if there is more to do.

Three states that are not failures: Sitoo with no credentials is **SKIPPED** (a
configuration fact — `SITOO_*` is absent in Production); Sitoo in worklist mode
is **SKIPPED** (nothing was written, so claiming OK would be an unobserved
success); Shopify readiness gaps are **BLOCKED** with a waiver offered, never
waived silently — a candle has no care page or fit guide.

The waiver is recorded on the **batch**, not passed per call, because it is a
decision about this product rather than about this attempt: a resume has to
honour it too. `createPushBatch` marks each block `waivable`, and only the soft
merchandising gaps are — no variants and no price are not on that list and no
button reaches them.

**Loom submits and confirms in separate invocations.** `submitLoom` passes
`skipJobWait`, persists `jobId` and leaves the item **AWAITING_JOB**;
`confirmLoom` makes one `getLoomJob` call per invocation. A crash mid-poll then
resumes by asking Loom about that job instead of re-sending a delivery it may
already be running. `loomIdentityPushedAt` is stamped on a **finished** job, not
on acceptance — and a job that fails after acceptance takes its
`ChannelPublication` back, because the 26 August failure was exactly the shape of
a row claiming a push that never landed.

**Product is born `DRAFT`.** It has no description, no photograph and often no
barcode; with the waiver above, ACTIVE would put it on the storefront on the
first push. Going live is a decision taken on `/catalog/publishing`. Adoption is
safe either way — `push-shopify` refuses to move a live product to DRAFT and
warns instead.

---

## Sitoo: the correction

`docs/sitoo-barnes-recreate.md` said a create path "does not exist" because the
v2 API rejects `variantparentid`. It does — that field is `readOnly` — but the
family is set through a different endpoint:

```
POST /sites/{site}/products                           creates; `sku` is the only
                                                      required field
PUT  /sites/{site}/products/{parent}/productvariants  sets the family
```

`scripts/check-sitoo-create.ts` proves it end to end against sandbox 91624.
Seven things that cost a round trip each, all now comments in the code:

1. **Repeated `sku=a&sku=b` returns only the LAST product** — 200, one row, no
   error. A create path built on that duplicates everything it misses. Use
   `sku=a,b,c`.
2. `active` is required on the variants PUT.
3. So is `deliverystatus`…
4. …and it is a **string**.
5. So are `moneypriceorg` and `moneyofferprice`.
6. Money must match `[-+]?[0-9]+\.[0-9][0-9]` — `"0"` is rejected, `"0.00"` is not.
7. `barcode` is required; `""` means none, `null` is refused.

Also: a child of a variant family cannot be deleted on its own — removing the
parent dissolves the family.

The **worklist creator is the default**. Sitoo is the till, and thirteen products
vanished from it unexplained on 12 September. The API path needs
`SITOO_CREATE_MODE=api`, refuses production without a second variable, pre-checks
every SKU, and aborts if the account's product count falls while it runs.

---

## Checks

No test runner in this repo, so these are scripts. All passing.

| | |
|---|---|
| `npx tsx scripts/check-sku.ts` | 20 assertions on SKU generation. No database needed |
| `npx dotenv -e .env.local -- npx tsx scripts/check-sku-corpus.ts` | Proves the corpus narrowing loses nothing: every one of 4,607 real SKUs, full vs narrowed. 0 lost, 95.7% smaller |
| `… scripts/check-finalize.ts` | 21 assertions: dry run writes nothing, two concurrent finalizes produce one set of rows, a resume creates nothing twice |
| `… scripts/check-wizard-flow.ts` | 20 assertions over real HTTP: CAS autosave, CSV round-trip, pre-flight, finalize |
| `… scripts/check-sitoo-create.ts` | Sandbox only. Creates a 3-size family, reads back `variantparentid`, cleans up |
| `… scripts/customs-audit.ts` | What the data supports before writing customs anywhere |
| `… scripts/survey-references.ts` | The category and brand vocabularies in all four systems |
| `… scripts/brand-sku-tokens.ts` | What token each brand actually uses, vs what the rule would derive |

---

## Open, and why

**Loom has not confirmed `registry_only`.** The registry payload now carries
price, category and customs alongside identity. `payload.ts` warned that a
registry carrying merchandising data invites Loom to render products it must not
sell; `registry_only: true` is the flag Loom is meant to gate on, and until Loom
says it does, this is a dependency on another team. WORK-DECK §A.

**Loom may not store the channel ids at all.** It answered `updated: 0` to all
355 identity rows sent so far (A2). The identity report says **sent**, never
stored, for that reason.

**Customs is not backfilled.** The writer and its dry run exist; writing to 4,584
live products is a decision. The ladder is 1 → 50 → 250s → then
`SHOPIFY_CUSTOMS_WRITE=on`.

**Seven brands have no SKU token** because their corpus is genuinely split —
Birkenstock is 53% BKST with BS on 28 rows, Subu is 31% SUBE. A null token means
the rule applies; picking the plurality would be a guess dressed as a
measurement.

**The Loom submit/confirm split is unverified against a live channel.** So are
the Shopify `inventoryItem { id }` capture, `recordShopifyVariantRefs`, and the
enriched registry payload. All three have been dry-run and none has seen a real
channel response — deliberately, since they write to production systems.

**No actor identity.** Everything is attributed to `FieldOwner.authority`, not a
person, and drafts are shared. Roles are step 0 for the vintage builder.
