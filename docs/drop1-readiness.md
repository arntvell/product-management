# FW26 Drop 1 — pre-push readiness

**As of 2026-09-18.** 72 merchandise colorways in `DROP-1`.

## Where it stands

| Field | Have | Missing |
|---|---:|---:|
| Recommended collection | **72** | 0 |
| Short description | 70 | 2 |
| Details | 68 | 4 |
| Care guide | 68 | 4 |
| Model info | **68** | 4 |
| Fit guide | 62 | 10 |
| Full description | 60 | 12 |
| **Status = DRAFT** | **72** | **0** |

**49 of 72 are complete on all seven.** 23 are not, listed below.

All 72 are now `DRAFT` in the master. Three were `ACTIVE` (Barnes Japan Indigo
Rinse, Ida White, Tia Japan Rinse) and none of them is on Shopify yet, so setting
them back cost nothing.

> **The flag does not unpublish anything already live.** The push never
> downgrades: if a Shopify product is ACTIVE and the master says DRAFT, it stays
> ACTIVE and the push warns. Master status only decides what a **create** lands
> as.
>
> **63 of the 72 do not exist on Shopify yet**, so they will be created as DRAFT
> — invisible on the storefront, exactly as intended. Of the 9 that do exist,
> **5 are ACTIVE and will stay ACTIVE**, receiving their updated content live:
>
> | | |
> |---|---|
> | Richmond / Black | `LIV-RCHMND-2-PCK-BLCK` |
> | Ida / White | `LIV-ID-WHT` |
> | Barnes / Japan Indigo Rinse | `LIV-BRNS-JPN-RNS` |
> | Nelson / White | `LIV-NLSN-ORGNC-WHT` |
> | Tia / Japan Indigo | `LIV-T-JPN-INDG` |
>
> To hold those five back, unpublish them in Shopify admin first, or leave them
> out of the push. The other four already on Shopify are DRAFT and stay DRAFT.

## What is missing, by field


### Full description — 12

- Agra / Black Metallic  `LIV-AGR-MET-SKI`
- Aiko / Black  `LIV-AK-GRY`
- Allegra / Black Metallic  `LIV-ALL-MET-DRE`
- Atohi / Oyster  `LIV-ATH-THRML-ZP-OYSTR`
- Atohi / Total Eclipse  `LIV-ATH-THRML-ZP-TTL-ECLPS`
- Becka / Coffee  `LIV-BCK-CFF`
- Blair / Black  `LIV-BLR-BLCK`
- Cardigan / Black  `LIV-CRDGN-BLCK`
- Collum / Black Check  `LIV-CLLM-BLCK-CHCK`
- Collum / Grey Check  `LIV-CLLM-GRY-CHCK`
- Rima / Black  `LIV-RM-BLCK`
- Selda / Black Metallic  `LIV-SEL-MET-LON`

### Details — 4

- Atohi / Oyster  `LIV-ATH-THRML-ZP-OYSTR`
- Atohi / Total Eclipse  `LIV-ATH-THRML-ZP-TTL-ECLPS`
- Becka / Coffee  `LIV-BCK-CFF`
- Cardigan / Black  `LIV-CRDGN-BLCK`

### Care guide — 4

- Binou / Dachs  `LIV-BN-DCHS`
- Binou / Porcelain  `LIV-BN-PRCLN`
- Collum / Black Check  `LIV-CLLM-BLCK-CHCK`
- Collum / Grey Check  `LIV-CLLM-GRY-CHCK`

### Short description — 2

- Atohi / Oyster  `LIV-ATH-THRML-ZP-OYSTR`
- Atohi / Total Eclipse  `LIV-ATH-THRML-ZP-TTL-ECLPS`

### Model info — 8

- APT / Blue Needle  `LIV-APT-BL-NDL`
- Binou / Dachs  `LIV-BN-DCHS`
- Binou / Porcelain  `LIV-BN-PRCLN`
- Collum / Black Check  `LIV-CLLM-BLCK-CHCK`
- Deka / Coffee Stripe  `LIV-DK-CFF-STRP`
- Ida / White  `LIV-ID-WHT`
- Lais / Blue Needle  `LIV-TBD-BL-NDL`
- Richmond / Black  `LIV-RCHMND-2-PCK-BLCK`

### Fit guide — 10

- Alpine / Butternut Heavy Waffle  `LIV-ALPH-BTTRNT-HVY-WFFL`
- Cavi / Black Waffle  `LIV-CV-BLCK-WFFL`
- Ida / White  `LIV-ID-WHT`
- Mila / Butternut Fade Out  `LIV-ML-BTTRNT-FD-OT`
- Nelson / Charcoal Melange  `LIV-NLSN-CHRCL-MLNG`
- Nelson / White  `LIV-NLSN-ORGNC-WHT`
- Noya / Faded Indigo  `LIV-NY-FDD-INDG`
- Paco / Black Slub Yarn  `LIV-PC-BLCK-SLB-YRN`
- Paco / Plum Slub Yarn  `LIV-PC-PLM-SLB-YRN`
- Selda / Black Metallic  `LIV-SEL-MET-LON`

## Reading the gaps

**Copy, not plumbing.** Full description (12), details (4) and short description
(2) are text nobody has written yet. Where a sibling colourway of the same style
already has it, it is style-level copy and can be carried across — that is how
Abby White was filled. Atohi Oyster and Atohi Total Eclipse are missing all three
and have no sibling to copy from.

**Fit guide — 10, and all of them are the known blocked list.** Alpine, Cavi,
Ida, Mila, Nelson ×2, Noya, Paco ×2, Selda are exactly the styles whose FW26
measurement charts have `grading_increment: 0`. They cannot get a fit guide until
design fills the increments — `docs/fitguides-fw26-chart-requests.md` is the ask.
Nothing to do on our side.

**Model info — 4 left.** The worn-but-never-hero rule is now in: a garment that
only ever appears as a supporting piece takes the model and size from the first
look that wears it, since the shoot knows both. That filled Binou Porcelain,
Collum Black Check, Richmond Black and APT Blue Needle, and took the master from
117 colorways with model info to **131**.

The four remaining are not in the look list at all, in any role — Binou Dachs,
Deka Coffee Stripe, Ida White, Lais Blue Needle. Nothing to derive from.

**Care guide — 4.** Binou ×2 and Collum ×2 are the scarves. They may genuinely
need a different care page rather than the garment one.

## Also fixed in this pass

**The model matcher preferred an exact name over the right season.** "Cavi Black"
matched the SS27 *Cavi / Black* exactly, so it never reached the FW26 *Cavi /
Black Waffle* the shoot meant. Season is now applied before the name. Four
colorways were re-pointed at their FW26 product — Cavi Black Waffle, Hyde Tee
White, Hyde Tee Black, Nox Navy Starch — and four SS27 twins were unlinked.

**Tia Japan Rinse is confirmed** as the shoot's "Tia Japan Indigo Rinse". The
master's name is the short form; Barnes, Fuller and Miko all call the same wash
"Japan Indigo Rinse" under the same `-JPN-RNS` SKU. Recorded in
`scripts/models/overrides.json` so it survives a re-run.

## Before pushing

1. Fill the copy gaps above, or accept those products pushing without it.
2. Upload the Drop 1 galleries — only 7 of 72 have images today.
3. Push with `allowIncomplete` on and **`clearEmptied` off**.

