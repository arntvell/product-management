# Model info — FW26

**As of 2026-09-16.** Height and size worn, per colorway, from the styling
team's look list (`model-products-list.rtf`).

## What it is

`Colorway.modelInfoId` points at a Shopify **metaobject of type `model`**, and
`push-shopify.ts:89` renders it into the `custom.model_info` metafield as:

> Model is 188cm tall and wearing a size M

A metaobject is one model **at one size** — `Alfred - M`, `Angelika - W26/L34` —
which is the convention the pre-existing rows already used (`Tarshana - S`,
`Tarshana - M`, `Tarshana - 36`). It has to be: a model wears S on top and 26/34
in jeans, so height alone cannot carry the sentence.

## Result

| | |
|---|---:|
| Looks parsed | **136** |
| Garment entries | **339** |
| Hero garments (one bold line per look) | **136** |
| Resolved to a colorway and a real variant size | **129** |
| Distinct colorways linked | **114** |
| `model` metaobjects (model × size) | **22** |
| Needing a human decision | **20** |

## How the source is read

The list gives, per look, several garments with exactly one in **bold**. The bold
one is the hero — the style whose product page that shot belongs to — so it is
the one that carries the model info. The other garments in the look are worn by
the same model but belong to other products' pages.

Two things about the RTF are worth knowing, because both silently corrupt the
data if missed (`scripts/models/parse_looks.py`):

- **Bold must be tracked per character.** The bold run closes (`\b0`) *before*
  the line break is written, so testing the flag at end-of-line reports every
  line as unbolded.
- **`\u8232` (U+2028) is a line break** — what a soft return in TextEdit
  produces. Treating only `\par` and backslash-newline as breaks merges looks
  together; it silently lost 5 looks on the first pass.

Converting the RTF to plain text first loses the bold entirely, so the RTF has to
be parsed as RTF.

## Models

| Model | Height | Looks |
|---|---|---:|

| Alfred | 188cm | 26 |
| Leo | 189cm | 21 |
| Emil | 189cm | 22 |
| Ram | 188cm | 14 |
| Angelika | 177cm | 28 |
| Sakoly | 178cm | 25 |

The list's first block carries no header; **Alfred** is the only one of the six
never named by a `Looks <name>` heading, so that block is his. **"Looks Leonard"
is read as Leo.** Both are inferences — worth a word of confirmation.

### Sizes each model was shot in

| Model | Sizes |
|---|---|
| Alfred | M (12) · L (2) · W29/L32 (11) |
| Leo | L (4) · M (16) |
| Emil | M (17) · L (2) · W32/L34 (1) · OS (1) |
| Ram | M (11) · W32/L34 (1) · L (1) |
| Angelika | S (10) · W26/L34 (11) · M (2) · XS/S (2) · W26/L32 (1) |
| Sakoly | S (16) · OS (1) · W26/L34 (2) · XS/S (1) · M (4) |

---

## Needs a decision — 7 garments not linked

Nothing was guessed here. Each row below has no model info until it is settled.

| Model / look | Listed as | Why |
|---|---|---|
| Alfred #14 | `Hayes Black 30/34` | several colorways match: Hayes Straight Suitpant / Black · Hayes Wide Suitpant / Black · Hayes Suit Pant / Black · Hayes Suit Jacket / Black |
| Leo #1 | `Nox Navy M` | several colorways match: Nox / Navy Starch · Nox / Navy Starch |
| Emil #18 | `APT Blue Needle` | no size given and the garment has several |
| Ram #2 | `APT Japan Skeleton Voile` | no size given and the garment has several |
| Angelika #9 | `Deka Brown Stripe S` | no colorway of that name; nearest: Deka / Grey Stripe · Deka / Coffee Stripe · Deka / Khaki Stripe · Sina Brown Stripe / Sina Brown Stripe |
| Angelika #14 | `Tia Indigo Rinse 26/34` | no colorway of that name; nearest: Tia / Japan Indigo · Tia / Japan Rinse · Miko / Japan Indigo Rinse · Fuller / Japan Indigo Rinse |
| Sakoly #11 | `Pen Stone Tech` | no size given and the garment has several |

Worth noting on two of them:

- **`Hayes Black 30/34`** (9 mentions in the list, 1 as hero) — FW26 has *Hayes
  Straight Suitpant*, *Hayes Wide Suitpant* and *Hayes Suit Pant* all in Black.
  "Hayes Grey" and "Hayes Brown" were fine because only the Wide comes in those.
- **`Nox Navy M`** — two live colorways are both called *Nox / Navy Starch*:
  `LIV-NX-NVY-STRCH` and `LIV-M-NX-001-BLCK-STRCH`. The second is one of the
  unapproved FW26 duplicates. This is a master data problem, not a styling one.

Also flagged: **`Hayes Charcoal 32/34`** appears 4 times in the list, but no FW26
Hayes colorway is Charcoal — the only Charcoal is a CONTINUITY trouser
(`LIV-Hayes-CH`). None of those four is a hero, so nothing is blocked, but the
list and the master disagree.

---

## Contested — 13 colorways heroed by more than one model

`modelInfoId` holds **one** reference, so a colorway shot on two models can only
publish one sentence. **The first look in the document was taken**, and the
alternatives are listed so any of them can be flipped.

| Colorway | Applied | Also heroed by |
|---|---|---|
| Hayes Double Breasted Jacket / Black `LIV-HYS-DBL-BRSTD-JCKT-BLCK` | **Alfred - M** (#2) | Emil - M (#2) |
| Aiden / Directory Blue Ox `LIV-ADN-DRCTRY-BL-OX` | **Leo - M** (#21) | Ram - M (#1) · Sakoly - S (#13) |
| APT / Windowpane `LIV-APT-WNDWPN` | **Emil - M** (#4) | Ram - M (#4) |
| Utmost / Green Plaid `LIV-UTMST-GRN-PLD` | **Emil - M** (#14) | Ram - M (#11) |
| Hayes Double Breasted Jacket / Brown `LIV-HYS-DBL-BRSTD-JCKT-BRWN` | **Alfred - M** (#7) | Angelika - M (#4) |
| Polo Coat / Black `LIV-PL-CT-BLCK` | **Leo - L** (#4) | Angelika - M (#5) |
| Noya / Faded Indigo `LIV-NY-FDD-INDG` | **Ram - M** (#12) | Angelika - S (#7) · Sakoly - S (#20) |
| Collum / Grey Check `LIV-CLLM-GRY-CHCK` | **Emil - OS** (#20) | Sakoly - OS (#3) |
| Beth / Japan Bronzer `LIV-BTH-JPN-BRNZR` | **Angelika - W26/L34** (#11) | Sakoly - W26/L34 (#6) |
| Blake / Taupe `LIV-BLK-TP` | **Ram - M** (#8) | Sakoly - S (#8) |
| Vinc / Chestnut `LIV-VNC-CHSTNT` | **Leo - M** (#3) | Sakoly - M (#14) |
| Cardigan / Black `LIV-CRDGN-BLCK` | **Emil - M** (#3) | Sakoly - S (#18) |
| Pull / Black `LIV-PLL-BLCK` | **Alfred - M** (#11) | Sakoly - S (#21) |

---

## Two wording points

- **One-size pieces** render as *"…wearing a size OS"* (Collum, the scarves).
  Accurate, but it reads awkwardly; the sentence is built in
  `push-shopify.ts:55` if it should drop the size clause for `OS`.
- **Jeans** render as *"…wearing a size W29/L32"*. That matches the Shopify
  variant title, but the fit guides publish bare waist (`29`). Worth deciding
  which the customer should see.

Neither was changed — both alter copy on every product, which is a
merchandising call.

## Re-running

```bash
python3 scripts/models/parse_looks.py model-products-list.rtf  looks.json
python3 scripts/models/match.py       looks.json master.tsv FW26 matched.json
python3 scripts/models/resolve.py     matched.json models.tsv resolved.json
python3 scripts/models/push.py        --resolved resolved.json --apply --sql-out link.sql
```

`push.py` reuses a metaobject whose name already exists rather than creating a
second, so a re-run corrects instead of duplicating. It is a dry run without
`--apply`.

`push-shopify.ts` already sends `custom.model_info`, so nothing else is needed —
the next Shopify push carries the sentence.

