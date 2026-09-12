# Cutover runbook

Everything below is built and committed on `main` (not pushed). Nothing has been
applied to the database or sent to any system.

Run in order — each step depends on the one above it. Every step has a dry run.

---

## 0. Apply migrations 1–4  ← START HERE, the app is broken until this runs

The Prisma client is generated against the new schema, so every `Colorway` query
now selects a `kind` column the database does not have. Verified directly:
`select "kind" from "Colorway"` → *column does not exist*. Collections, the
editor and Fix will all 500 until this runs.

Migrations 1–4 are additive: new tables, nullable columns, one column with a
default, one enum value. **Migration 5 — the unique index on `Variant.barcode` —
is held back deliberately**, and `migrate deploy` has no "up to" flag, so:

```bash
mv prisma/migrations/20260911090400_variant_barcode_unique /tmp/
npm run db:deploy
mv /tmp/20260911090400_variant_barcode_unique prisma/migrations/
```

**Then restart `npm run dev`.** Turbopack bundles the Prisma client, so a running
dev server keeps the old one and will still fail. The client is already
generated — no need to re-run `prisma generate`.

I attempted this and the Claude Code auto-mode classifier blocked it, same as the
carry-forward apply and the `git push` earlier in this work.

---

## 1. Load the barcode ledger

Teaches the master every number already issued, so allocation cannot reissue one
that is printed on a garment. 9,822 rows, all check digits valid.

```bash
python3 scripts/load-barcode-ledger.py \
  snapshots/2026-09-11/worklists/barcodes-2026-09-11.csv \
  --authority cfo-list-2026-09-11            # dry run
python3 scripts/load-barcode-ledger.py ... --apply
curl -s localhost:3000/api/catalog/barcodes/ledger | jq   # high-water marks
```

Expect `7072536` at 12,257 and `7000000` at 2,444.

---

## 2. Classify product kind

Moves merchandise / material / aggregate out of `reconcile.py` and into the
master, so stock figures and import gates stop being wrong in the same way twice.

```bash
curl -sX POST localhost:3000/api/catalog/classify-kind -d '{"dryRun":true}' | jq
curl -sX POST localhost:3000/api/catalog/classify-kind -d '{}' | jq
```

Check the `examples` array before applying. Individual `IMP-` garments must stay
`MERCHANDISE`; only the `LIV-IMP-*-OS` buckets become `AGGREGATE`.

---

## 3. Link the channels

Match Origio variants to the records that already represent them. **Both linkers
match only — neither creates anything.**

```bash
curl -sX POST localhost:3000/api/catalog/sitoo/link   -d '{"dryRun":true}' | jq
curl -sX POST localhost:3000/api/catalog/shopify/link -d '{"dryRun":true}' | jq
```

Both were projected against the 2026-09-11 snapshot before being written, so the
numbers to expect are known:

| | Sitoo | Shopify |
|---|---:|---:|
| matched by SKU | 4,086 | 4,085 |
| matched by barcode | — | 26 |
| **ambiguous** | **0** | **0** |

Shopify holds 41 barcodes on more than one variant and 150 repeated SKUs, but
none of them make an *Origio* variant ambiguous. The unmatched remainder is
expected: SS27 is pre-season and not in Shopify, and 7,704 archived Shopify
variants are deliberately excluded.

Then re-run each without `dryRun`.

---

## 4. Apply the barcode corrections to Origio

Replaces the generated SQL used on 2026-09-11 — same corrections, now with
canonical form, check digits, a collision guard, and an attribution.

```bash
curl -sX POST localhost:3000/api/catalog/barcodes/apply -d '{
  "corrections":[{"variantSku":"...","barcode":"..."}],
  "authority":"cfo-list-2026-09-11",
  "evidence":"snapshots/2026-09-11/worklists/barcode_corrections.csv",
  "dryRun":true }' | jq
```

The route refuses a correction with no `authority`. Afterwards any value can be
explained:

```bash
curl -s 'localhost:3000/api/catalog/explain?entityType=variant&entityId=...' | jq
```

---

## 5. Migration 5 — the unique index

Only once steps 1–4 are done and the corrections are in. It nulls 22 `STORAGE-*`
placeholders on `'0'` and the older half of one duplicate pair, then adds the
index. **24 rows, all identified.** After this, a duplicate barcode is impossible
rather than merely unlikely.

```bash
npm run db:deploy
```

---

## 6. Push to Sitoo — sandbox first

```bash
curl -sX POST localhost:3000/api/catalog/push/sitoo -d '{"dryRun":true}' | jq
```

**Rehearse first.** `python3 scripts/sitoo/rehearse.py` replays the shape of the
run against the sandbox — same family spread, same writes into the heaviest
family, no delay — and checks that no product and no variant family is lost.
Skipping this is how 13 Barnes Japan Dawn products came to be missing on
2026-09-12.

The plan separates `unwind` from `writes`. Rotated size runs are unwound before
being rewritten — verified against both real cases: `LIV-CN-BCHK` plans 2 unwinds
and 3 writes, `LIV-HNR-BGST` 3 and 4, with no target left blocked.

**Both API questions are now answered** — verified against the sandbox on
2026-09-12, recorded in `src/lib/sitoo/client.ts`:

| | |
|---|---|
| `PUT /products/{id}` | **patches.** A real barcode change left all 25 populated fields intact — title, price, sku, VAT, SEO. A targeted write is safe. |
| `barcode: null` | **rejected, HTTP 400.** The empty string clears it. This was a live defect: the unwind phase sent null and would have failed mid-run, stranding those products without a barcode. Fixed. |
| `barcodealiases` | takes a list of plain strings. Additional codes that also scan — see the Norda note below. |

The sandbox is a **separate account** (91624 vs 91622), so its product ids are
unrelated to production. It is right for checking API behaviour and useless for
rehearsing a write set. `pushBarcodesToSitoo` now verifies each product's SKU
before writing: pointed at the sandbox, the production plan refuses all 4,111
links and plans zero writes.

---

## 6b. Push to Shopify

```bash
curl -sX POST localhost:3000/api/catalog/push/shopify/barcodes -d '{"dryRun":true}' | jq
```

Shopify does **not** enforce barcode uniqueness — it holds 41 barcodes on more
than one live variant today — so the plan refuses any write that would put one
code on two variants rather than relying on the API to reject it. Read `blocked`
before applying.

---

## 7. Backfill the 4,552

The last read from the downstream systems before they become write-only.

```bash
python3 scripts/reconcile/fetch.py            # re-snapshot: the stock gate goes stale
python3 scripts/reconcile/reconcile.py snapshots/<today>
```

That writes `import-allowlist.json` — 4,599 allow, 111 deny. Feed it to
`ImportGate` in `src/lib/cin7/import.ts` via `previewCin7Import(brands, gate)`,
review, then `runCin7Import(brands, gate)`.

---

## 8. Loom as the stock registry

```bash
curl -sX POST localhost:3000/api/catalog/push/loom -d '{"mode":"data","dryRun":true}' | jq
```

`data` mode now carries every stocked variant regardless of brand, with an
identity-only payload. `full` mode is unchanged: Livid production only,
readiness-gated, so no external or vintage product reaches the wholesale
catalogue.

---

## Still open

| | |
|---|---|
| ~~Physical scan~~ | **Settled 2026-09-12.** Two stores confirmed by phone that the physical labels carry `7072536051*`. Sitoo held `7072536087*`, which is why those eight Barnes Japan Dawn sizes would not scan at the till. The eight variants are unlocked with authority `store-scan-2026-09-12` and are in the Sitoo plan. The three Hayes Taupe variants stay locked — Hayes uses `7072536094*` in Cin7 and Sitoo, never `087*`, and the style retires end of September. |
| Norda store labels | 5 variants where Sitoo holds a shop-printed `99*` code and the master holds Norda's own EAN. The push keeps what scans. **Sitoo's `barcodealiases` is the real fix** — verified working — so both codes resolve at the till instead of one being discarded. Needs a decision on which is primary. |
| Cin7's 75 twins | 5 are denied by the allowlist. The rest need resolving before backfill or both halves import. |
| Reconcile UI | Findings are JSON and curl. A surface in Origio is the natural next build. |
| 259 mixed-case SKUs | `LIV-Aino-M`, plus 44 slashed like `LIV-HYS-TP-28/34`. Matching normalises both sides, but the master holds two conventions. Rewriting them changes identity other systems know, so it needs a decision, not a script. |
