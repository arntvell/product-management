# UPC-A barcodes are stored as 12 digits (2026-09-23)

## Why

`canonical()` in `src/lib/master/barcode.ts` padded every 12-digit UPC-A to 13
digits with a leading `0` ("We store 13"). The import applied it, so the 28
Pantherella variants imported on 2026-09-22 went to Shopify, Sitoo and Loom as
`0884597…`, and **the zero-padded form does not scan at the till**. They were
stripped by hand in all four systems (`scripts/pantherella-upc/fix.mjs` in
builder, read back 28/28). The variant editor could not do it: its plan
compared canonical forms, so `884…` over `0884…` came back "unchanged", and
the Shopify and Sitoo planners reported "agrees".

## The rule

A barcode has an **identity** and a **spelling**.

| Question | Compare |
|---|---|
| Does anything else hold this code? (collisions, duplicates, link joins) | `barcodeKey()`, the 13-digit form |
| Is this value different from that one? (changed / unchanged / agrees) | the strings |

New helpers in `barcode.ts`:

- `barcodeKey(raw)` is identity. It is the old `canonical()`, renamed so each
  caller shows which question it is asking.
- `storedForm(raw)` is what the master stores for a **new** value: a UPC-A as its 12 digits, an EAN-13 as itself.
- `cleanBarcode(raw)` validates and strips formatting without re-spelling. It is used on the way **out**.
- `barcodeSpellings(raw)` gives both spellings, for `barcode: { in: … }` lookups.
- `channelNeedsBarcode(live, master)` says whether a channel needs a write. Yes for a different code. For the same code in
  another spelling, yes **only to drop a zero, never to add one**.

**Inbound normalises, outbound never does.** The master held 416 zero-prefixed and 211 twelve-digit rows on 2026-09-23.
They are **not migrated**. A channel may hold the padded code and scan it fine. If a push re-spelled
the master's value, every one of those rows would be stripped in its channel on its next push.

## Audit of every former `canonical()` caller

| File | Before | Now |
|---|---|---|
| `import-products.ts:370` | stored the 13-digit form | stores `storedForm`; in-file duplicate check keyed by `barcodeKey` |
| `finalize.ts` (≈182, 444, 582) | stored the 13-digit form; taken-check was an exact `in`, so it missed the 211 twelve-digit rows | stores `storedForm`; taken/ledger checks look up both spellings, matched by key |
| `draft-barcodes.ts` (CSV into draft) | 13-digit form into the payload | `storedForm`; duplicate check keyed by `barcodeKey` |
| `add-size.ts` (new on main) | 13-digit form; exact `in` taken-check | `storedForm`; both spellings; "different from existing" by key |
| `apply-barcodes.ts` | holder map keyed by the raw DB string, so a 12-digit holder was invisible to a 13-digit target | holders and claims keyed by `barcodeKey`; writes `storedForm`; a same-code re-spelling is a change only with the new `reformat` option |
| `variant-barcodes.ts` (the `/catalog/variants` editor) | 12 over 0+12 reported "unchanged" | passes `reformat: true`; preview `from` shows the stored spelling; Shopify dup-search asks for both spellings |
| `shopify/push-barcodes.ts` | sent the 13-digit form; "agrees" by identity | sends the master's spelling (`cleanBarcode`); decides by `channelNeedsBarcode`; dup guard by key |
| `sitoo/push.ts` | same as Shopify; unwind matched raw values | same as Shopify; unwind matched by key |
| `cin7/import.ts` | existing-barcode set was raw strings; stored the 13-digit form | set keyed by `barcodeKey`; stores `storedForm` (Cin7 holds UPCs padded, e.g. `0195208040573`) |
| `import-gaps.ts` | display | `storedForm` for display |
| `threadflow/sync.ts` | update wrote the 13-digit form over every non-manual row | update skips when the held code is the same barcode in either spelling. **Create is unchanged** (writes as Threadflow gives it): this path has no identity check, so the unique index is its only guard, and re-spelling there would let a pair through it |
| `lookup.ts` | exact match on the 13-digit form, so the 211 twelve-digit rows were unfindable by barcode | searches both spellings; mismatch still by identity |
| `shopify/link.ts`, `sitoo/link.ts`, `barcode-inference.ts`, `step-barcodes.tsx` | identity/validation | renamed to `barcodeKey`, no behaviour change |
| `recordIssued` / `parseAllocation` / `isInternalRange` | — | unchanged: Livid's ranges start `7`, never `0`, and `isInternalRange` already looked past the padding zero |
| `normalize-size-labels.ts`, `normalize.ts` | a different `canonical` | untouched |

Create paths that already sent `v.barcode` raw (Loom payload, Shopify create, Sitoo
api-creator) need no change: they now carry the 12 digits because the master does.

## The unique index cannot see both spellings

`Variant.barcode @unique` compares strings, so `884597234150` and `0884597234150`
can sit on two garments as far as Postgres is concerned. There were **no such
pairs** on 2026-09-23. Every writer above checks by key before writing. A raw
path (Threadflow create, a one-off script) is still guarded only by the string
index. The DB-level fix is an expression index. Prisma cannot express it, so it is here and **not
applied** (schema changes are Kristoffer's to run):

```sql
-- Refuses a second garment on the same barcode in either spelling.
-- Pre-check: returns no rows on 2026-09-23.
--   SELECT a."variantSku", b."variantSku" FROM "Variant" a
--   JOIN "Variant" b ON a.barcode = '0' || b.barcode;
CREATE UNIQUE INDEX CONCURRENTLY "Variant_barcode_identity_key"
  ON "Variant" ((CASE WHEN length(barcode) = 12 THEN '0' || barcode ELSE barcode END))
  WHERE barcode IS NOT NULL;
```

Caveat: `prisma migrate dev` may report an index it does not know as drift. Check that
before adding it as a migration rather than running it by hand.

## Verified

- `scripts/check-barcode.ts` has 36 pure checks: identity, spelling, the channel
  rule, and the master plan (editor re-spell, no zero added, bulk lists don't
  migrate, cross-spelling collisions).
  Run: `ORIGO_POSTGRES_PRISMA_URL='postgresql://u:p@127.0.0.1:1/none' npx tsx scripts/check-barcode.ts`
- `scripts/check-import.ts` (read-only mode) passes, with a new UPC-A row that must come back as 12 digits.
- A read-only probe against production data:
  - The editor on `EXT-KEEN-JAS-ATBR-43` (master `0199289005353`) plans `→ 199289005353`, and Shopify and Sitoo say "agrees". They
    already hold `199289005353`, read back directly.
  - A bulk correction (no `reformat`) with the zero leaves the row unchanged.
  - `planSitooPush` over all 416 legacy rows plans 0 re-spellings. Its 1 write
    (`EXT-PNT-YS1025-01-L`) is a genuinely different code, and the old code planned it too.
- `tsc --noEmit` clean. `check-style-splits.ts` fails 2 checks, the same on `main` before this change.

## Not done

- No production data changed. The 416 legacy rows stay as they are.
- The 28 Pantherella rows have no `FieldOwner` (manual barcode) record. Writing
  one would stop a future Threadflow update rewriting them, but they are
  `MANUAL`-source external products that Threadflow does not own.
