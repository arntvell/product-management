# M.O.P buttons into Loom (STORAGE), 2026-10-07

The production buttons `2526-1208-*` were in Cin7 and Pio but not in Loom.
Kristoffer wanted them in Loom so their stock is tracked there, in the season named
exactly `STORAGE` (Loom sends STORAGE products to Pio without barcodes), and in the
same season in Origio.

## Before

- **Cin7:** 35 SKUs, 5 colours × 7 sizes (L16–L32), category Button, no barcodes.
  17 sizes had stock.
- **Origio:** imported 2026-08-21 as **5 one-colourway styles** named like
  "M.O.P button 515 Smoke". Only the 17 stocked sizes existed, kind MATERIAL, filed
  under CONTINUITY.
- **Loom:** none of the 41 keys (style, colours, sizes).
- **Why they never reached Loom:** the registry payload drops barcode-less variants
  of Livid-brand products unless the kind is CONSUMABLE. MATERIAL was not exempt,
  so all of them were dropped.

## What changed

1. **Code:** `c247f4c` on `main` (`src/lib/loom/payload.ts`). MATERIAL now takes the
   same barcode exemption as CONSUMABLE. These 5 are the only MATERIAL colourways.
2. **Origio data** (`scripts/mop-buttons/apply.mjs`, one transaction, safe to re-run):
   - Style `2526-1208-515` renamed to `2526-1208` "M.O.P button". All 5 colourways
     moved under it and renamed "511 White", "5120 Trocas Smoke Brown", "515 Smoke",
     "516 White White" and "517 White", with `color` set.
   - The 18 missing sizes created (no barcode), so all 35 exist.
   - New Origio `Season` `STORAGE` (kind CONTINUITY, so it stays out of the
     carry-over targets). Each colourway's CONTINUITY entry was **moved** to STORAGE,
     not duplicated, so a CONTINUITY push never files them in Loom's Archive. Cin7's
     placeholder prices (0.01 NOK, 0.05 EUR/USD) stay on CONTINUITY and never reach Loom.
   - The 4 emptied styles were deleted. They were never in Loom, so there are no shells.
3. **Loom push** (`scripts/mop-buttons/push.mjs`): `mode: "data"`, `seasonCode: "STORAGE"`.
   - **First attempt:** a bare HTTP 500 with no job. Loom's `/identity` also 500'd
     briefly at the same time. A read-back showed nothing had applied.
   - **Resend** with a fresh `eventId`: job `cmuyl9vpo001agq0f0056muuk`, `done`,
     **created 5, variantsCreated 35, itemErrors []**.

## Read-back (`scripts/mop-buttons/verify.mjs`)

- 40/40 colourway and size keys are known to Loom.
- Every colourway is under style `2526-1208` "M.O.P button", in season `STORAGE`,
  with 7 sizes.
- Each has a Pio product ref (3596849, 3596813, 3596820, 3596865, 3596827), synced
  20:57 UTC.
- In Origio, `ChannelPublication(LOOM)` reads `published: true, lastPushStatus: ok`
  on all 5.

## Open

- **Stock:** right after the push, Loom showed no stock rows. The Pio refs are new
  numbers, so either Pio made new products or Loom linked to existing ones under
  new ids. If Pio's stock stays absent, it has to be resolved between Loom and Pio.
  Cin7's figures to compare against:
  511-L16 36,000 · 511-L18 36,000 · 515-L16 13,992 · 515-L18 4,604 · 515-L20 20,264 ·
  515-L24 9,940 · 515-L28 130 · 515-L32 168 · 516-L18 14,000 · 516-L20 400 ·
  517-L16 111 · 517-L18 6,984 · 517-L20 547 · 517-L24 15 · 5120-L18 370 ·
  5120-L24 120 · 5120-L32 70.
- **Average cost:** not sent. Cin7's AverageCost (300–336) looks per-pack rather
  than per-button.
