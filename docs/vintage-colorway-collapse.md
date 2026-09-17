# Vintage colorway collapse — diagnosis and repair plan (2026-09-17)

Triggered by: "`EXT-VN-NW-USBRSHRT` (US Heritage Brand Shirt) — is this in Origio?
I can't find it in Loom."

## The short answer

It is in Origio, but **not as a product**. It is a *variant* of a colorway called
`EXT-VN-NW` whose name is **"RUGBY SHIRT"**. Loom holds it exactly as we sent it —
as a size code `USBRSHRT` under a product called RUGBY SHIRT. Searching Loom for
"US Heritage Brand Shirt" finds nothing because **that name exists nowhere in
either system**.

Loom's audit and the search are both right. Nothing is missing. The shape is wrong.

## Cause

`splitSku()` in `src/lib/cin7/import.ts` treats the last hyphen segment as the size:

```
EXT-VN-NW-USBRSHRT   ->   base "EXT-VN-NW",  size "USBRSHRT"
```

For vintage the trailing token is the **garment type**, not a size. So every
`EXT-VN-NW-*` SKU grouped into one colorway, which took `rep.Name` — the name of
whichever product the loop saw first — and the other 25 names were discarded.

`deriveSize()` accepts any token as a size label, so nothing rejected it.

## Scope — Vintage brand

Vintage holds 1,882 colorways / 2,355 variants. Two defects:

### A. Collapsed colorways — 15 colorways holding 488 variants

| colorway | appears in Loom as | variants |
|---|---|---|
| `VN-ONLN` | "Polo Ralph Lauren Shirt (S)" | **391** |
| `EXT-VN-NW` | "RUGBY SHIRT" | 26 |
| `EXT-VN` | "Oxford Shirt" | 19 |
| `VIN` | "RL Shirt Short Sleeve" | 12 |
| `EXT` | "Velour top" | 7 |
| `EXT-VN-NW-SLK` | "SILK SHIRT LONG SLEEVE" | 6 |
| `EXT-VIN`, `EXT-VIN-PR`, `EXT-VN-LVSN-BK`, `EXT-VN-LVSN-BL` | | 4 each |
| `VN-KNT` | "Solid color knit" | 3 |
| `EXT-VN-NW-JHS`, `-LLW`, `-LVS`, `EXT-VN-PRNT-SHRT` | | 2 each |

**473 of those 488 products have no name anywhere** — only the 15 representatives
kept one. That is the real damage.

`VN-ONLN` is the worst: 391 distinct vintage garments sold online, all sitting in
Loom as sizes of a single Polo Ralph Lauren shirt.

Why only these: Cin7's newer vintage SKUs carry an explicit `-OS`
(`VN-ONLN-10000-OS`), which splits correctly. The older ones do not
(`VN-ONLN-4399`), and the numeric tail is consumed as a size.

### B. Latent truncation — 24 single-variant colorways

`VIN-DNM` / `VIN-DNM-SKRT` (size "SKRT"), `VIN-JQ` / `VIN-JQ-KNT`, `VIN-HAT` /
`VIN-HAT-299` (a *price* as a size), and 21 more.

**These are low priority.** The colorway SKU is truncated and the size label is a
garment code, but the *name is correct* — `origioName == cin7Name` on all 24 — so
they are findable in Loom. They are a latent trap rather than present damage: a
second `VIN-DNM-*` SKU would collapse into `VIN-DNM` and reproduce defect A.

## All of it is recoverable

Checked against the live Cin7 catalogue: **488 of 488** have their real name, and
**488 of 488** have a Retail price. Nothing has to be invented.

Names need the `colorwayName()` treatment — Cin7 writes the size into some of
them ("Levi's 501 (W33) W33").

## The target shape

Taken from the 1,843 Vintage colorways that are already correct, not invented:

```
colorway VN-ONLN-9342        name "Polo Ralph Lauren Shirt (L)"
  variant VN-ONLN-9342-OS    sizeLabel OS
style    VN-ONLN-9342
```

- `variantSku == colorwaySku + "-OS"` on 1,843 of 1,867
- `colorwaySku == variantSku` on **0** of them
- `styleSku == colorwaySku` on 1,744 of all Vintage colorways

The last line matters: the importer's own guard calls `styleSku == colorwaySku`
"the shape that modelled colours as standalone styles" and refuses to create it,
yet it is the established convention for vintage one-of-ones, 1,744 times over.
For a one-of-one it is arguably correct — the garment *is* the style. **This needs
a decision, not an assumption** (see Open questions).

## Can a push fix it?

**No.** A push carries whatever Origio holds, and Origio holds the wrong shape.
Two steps, in order.

### Step 1 — repair Origio (production data write)

For each of the 488:

1. new `Style` row (or reuse, per the decision below)
2. new `Colorway` row — name and price from Cin7, `source` kept, brand Vintage
3. `UPDATE Variant SET colorwayId` — **the variant id never changes**, which is
   what preserves Loom's stock, cost and order history
4. `SeasonEntry` + `SeasonVariant` in CONTINUITY, mirroring `cin7/import.ts`
5. `Price` per colorway from Cin7 `Retail` (NOK MSRP)

Then the 15 old colorways keep their rows, lose their variants, and get
`channels.loom = false` to withdraw them.

**Why leave the old colorway alive:** it keeps its style non-empty. A style whose
colorways all move away stops appearing in the payload entirely and Loom is left
holding a shell — `channels.loom` exists on colorways only, so a style cannot be
withdrawn. Keeping one withdrawn colorway under each old style sidesteps that.

Verified: `payload.ts:358` builds colorways with a plain `.map` and no
colorway-level filter, so a colorway with `variants: []` **is still emitted** and
the withdrawal does transmit.

### Step 2 — push to Loom

`mode: "data"`, season CONTINUITY → `archv`, scoped to the 488 new + 15 withdrawn
colorway ids, explicit unique `eventId`, then `GET /jobs/<id>` to read
`variantsCreated` / `variantsUpdated` / `itemErrors`.

## The one unproven thing

**Does Loom accept a variant moving to a different colorway?**

Loom enforces stable-identity ownership — their log shows
`product SKU X is owned by stable colorway <id>` and
`variant SKU Y is owned by stable variant <id>`. Both are SKU-collision errors;
neither is a parent-change error, so we have no evidence either way.

Origio cannot test this: the push `dryRun` builds without transmitting, and Loom's
client has no product read endpoint.

**Proposed test — one variant, one push.** Split `EXT-VN-NW` alone (26 items),
push it with an explicit `eventId`, and read the job:

| result | meaning |
|---|---|
| `variantsUpdated: 26`, no errors | Loom re-parented. Proceed with the rest. |
| `variantsCreated: 26` | Loom duplicated. The old variants need withdrawing and stock history is split. |
| `itemErrors` on ownership | Loom refuses a re-parent. Needs their side to change, or a different approach. |

Better still, ask them first — one concrete question they can answer with one
query: *"For variant `57a29f1a-5160-4e42-b149-48c67e6e8a3e`, what happens if the
next `data` push places it under a new `colorway_id` instead of
`cfa4c1a2-8df6-4aab-b367-e8dd1102728f` — move, duplicate, or error?"*

## Open questions for Kristoffer

1. **Style per item, or one shared style?** 488 new colorways implies up to 488
   new `Style` rows, of which 391 for `VN-ONLN`. That matches the existing 1,843
   one-of-ones, and `grouping.ts:7` deliberately excludes vintage from
   regrouping — but 391 new style rows is not a small number.
2. **`styleSku == colorwaySku` for the new rows?** It is the established vintage
   convention (1,744 rows) and it is the shape the importer refuses to mint.
   Consistency vs the stated rule.
3. **`VN-ONLN` SKU form.** The correct rows are `colorwaySku` + `-OS` on the
   variant, but these 391 SKUs have no `-OS` in Cin7 or Sitoo. Renaming the
   variant would break the Sitoo match key, so either the colorway SKU equals the
   variant SKU for these, or the colorway takes a minted SKU.

## Sequencing — the Cin7 backfill stays on hold

The pending import (`snapshots/sitoo-backfill-allowlist.json`) **would reproduce
this defect on 121 SKUs across 25 bases**, including 12 more garment types into
`EXT-VN-NW` and 19 into `EXT-VN`.

`splitSku`/`deriveSize` must learn to reject a non-size trailing token before that
import runs. Care needed: real waist sizes appear in the same position
(`LIV-JNE-JP-SHRT-BG-W27`), so the size vocabulary has to be right first.

Order: fix `splitSku` → re-preview the import → repair the vintage collapse →
push both.
