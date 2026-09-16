# Answer to Loom's split-styles hand-over — 2026-09-16

Their list: 176 styles reaching Loom as two or more, so the colourways never
group. 38 of them carry a Livid SKU; those are the ones answered here.

## You are right that it cannot be fixed on your side, and right about where

Grouping on our side is the `Colorway.styleId` foreign key and nothing else —
`src/lib/loom/payload.ts` builds one block per style and nests that style's
colourways in it. So the repair is an `UPDATE Colorway SET styleId`, and
**`style_id` and `colorway_id` in the payload are our primary keys passed through
verbatim**. No colourway is deleted, re-created or re-keyed. Your first
constraint is met by construction, not by care.

## What caused it

Two importers, two different faults.

**The Cin7 importer resolved the parent style by name and then looked it up by
SKU.** It correctly matched "Abby" against the Threadflow style, discarded
everything but the name, synthesised `LIV-STY-ABBY` from it, looked *that* up,
missed — because Threadflow's Abby is `LIV-W-BBY` — and created a second Abby.
Every `LIV-STY-*` style you hold is one of these. It now attaches to the matched
style's id, so the lookup cannot miss.

**The Shopify importer minted one style per product**, with
`styleSku = colorwaySku = handle`. That is the other half: a colourway that is
its own style, with the colour in the style name — `Riley Navy`, `Tuck Black`.
It now reuses an existing style of the same name within the brand.

A third path, a legacy bulk builder that wrote `styleSku === colorwaySku`, has
been deleted outright.

## Per style

### A. Settled — 22 styles retire into 22

| garment | CURRENT style_id | its style_sku | RETIRING style_id | its style_sku | colourways moving |
|---|---|---|---|---|---|
| Abby | `669e7f61-eebd-424e-8b3a-76ca1cdc82c9` | `LIV-W-BBY` | `36e03c0f-d213-4e56-aea4-cce6cc048033` | `LIV-STY-ABBY` | 3 |
| Amber | `5b660471-e863-44d3-8085-8ec379214afc` | `LIV-W-MBR` | `7bdb7cbd-1261-4950-9c23-eb122547d997` | `LIV-STY-AMBER` | 1 |
| Barnes | `cmrjkjzgk00cnkyc9ht8svb75` | `LIV-M-BRNS` | `965dc770-e842-4f2c-95f6-9a2158b1bb61` | `LIV-STY-BARNES` | 9 |
| Binou | `b92e5329-2b59-4de8-be73-653e7fbc944b` | `LIV-W-BN` | `c93b2616-6432-43a3-8ba3-08d47e17fdec` | `LIV-STY-BINOU` | 1 |
| Blake | `d2fa8fbb-316c-4dc9-bad9-3e31febe25f6` | `LIV-M-BLK` | `37b5cf56-30ba-4846-bcf6-b8d3e2922d45` | `LIV-STY-BLAKE` | 2 |
| Deka | `a6579596-8ebf-45d7-9e52-1055e9b9d120` | `LIV-W-DK` | `9207431c-7964-472f-984e-79f37728b347` | `LIV-STY-DEKA` | 2 |
| Eva | `cc5b62c0-aa0f-42a8-aa24-5c4ece4eb110` | `LIV-W-V` | `2fc7ec64-4f0f-405f-80d2-e4634aa72938` | `LIV-STY-EVA` | 5 |
| Fealy Twisted | `073a1aa0-ad2e-4d92-8e0f-70f7b50b5548` | `LIV-M-FLY-TWSTD` | `6b951106-b3fe-41df-8d07-b3db28345b5e` | `LIV-STY-FEALY-TWISTED` | 1 |
| Fir | `add4a58c-1690-4331-8592-dd14e1ed7fd3` | `LIV-W-FR` | `5d971dd0-6eb7-40bb-854c-1396737c1e57` | `LIV-STY-FIR` | 1 |
| Franca | `5ed50b82-d4a1-43e7-af52-ce1bb688b356` | `LIV-W-FRNC` | `fa676e36-1ec1-4e83-a7f7-e43dcdc9fe3a` | `LIV-STY-FRANCA` | 1 |
| Hume | `fe044f3c-830b-4a03-9be8-be62cbffb517` | `LIV-M-HM` | `1ad20cfc-b8ea-4129-a9e5-9c2b924f2be8` | `LIV-STY-HUME` | 2 |
| Ida | `8aa1edaf-1f61-486a-8600-243bfd6e9edf` | `LIV-W-D` | `fea3a3dd-1496-4527-a874-ebc417acfd65` | `LIV-STY-IDA` | 3 |
| Keller | `1b41573f-9a5e-465b-a337-d92e78254fcb` | `LIV-M-KLLR` | `81612f75-9958-440c-93f0-c8d61a7fbaec` | `LIV-STY-KELLER` | 5 |
| Lais | `9d39aa9e-e324-41ca-8f13-7d3e1024b75e` | `LIV-W-LS` | `13b2a4f2-2301-48eb-9a45-3d6c221e365f` | `LIV-STY-LAIS` | 1 |
| Lima | `8fc34c5c-8991-430e-b651-abde63fc3e03` | `LIV-W-LM` | `68cec82a-9844-44a4-93e0-774530d4c67e` | `LIV-STY-LIMA` | 1 |
| Mila | `7f276150-7b21-443d-ae7f-b38602911f90` | `LIV-W-ML` | `148be8ac-5c89-47b8-9fa6-9a32b3ed16d5` | `LIV-STY-MILA` | 7 |
| Needle | `72d383c7-52c2-42c3-94d6-2ea766e798e2` | `LIV-M-NDL` | `f0c41391-a711-45a2-b129-e45bbcf13093` | `LIV-STY-NEEDLE` | 3 |
| Nelson | `0a458947-1330-4319-a7e2-e7c2556f4c44` | `LIV-M-NLSN` | `6c5b3230-dcb2-4280-8919-cb43f376a7d9` | `LIV-STY-NELSON` | 22 |
| Richmond | `4b07b9fa-4746-48e7-9e6a-de4161f8f08c` | `LIV-M-RCHMND` | `eb89d715-16b3-49f8-8789-8d9298727b04` | `LIV-STY-RICHMOND` | 2 |
| Stack | `f107cb25-1c87-4d53-8f7a-19b565c1745a` | `LIV-M-STCK` | `2a5d688e-e63c-4d8e-9900-2f8bf4aef30a` | `LIV-STY-STACK` | 1 |
| Tia | `275a9c3f-8f9f-4036-b114-cca27d0999ae` | `LIV-W-T` | `914ca474-1e22-46f6-b909-771848e61a7b` | `LIV-STY-TIA` | 1 |
| Tiki | `cmrjkgs9c000kkyc97xq3tnuu` | `LIV-W-TK` | `dfca264c-e745-459b-bc31-5bb128149abb` | `LIV-STY-TIKI` | 7 |

### B. Still under review at our end — 11

| garment | proposed CURRENT style_id | its style_sku | other style_id | its style_sku | colourways |
|---|---|---|---|---|---|
| Cassidy White Oxford | `7b926442-0310-4224-bd6d-3881b0cc92a3` | `LIV-STY-CASSIDY-CANDY-STRIPE-OXFORD (renamed “Cassidy”)` | `dbbc1f4f-a4ec-40c0-b35c-a85aa751b1fd` | `LIV-CSSDY-WHT-OXFRD` | 1 |
| Cassidy White Oxford | `7b926442-0310-4224-bd6d-3881b0cc92a3` | `LIV-STY-CASSIDY-CANDY-STRIPE-OXFORD (renamed “Cassidy”)` | `309605a1-9d6e-426f-a2a1-a6621d16875b` | `LIV-STY-CASSIDY-WHITE-OXFORD` | 1 |
| Cedarwood Incense | `f9750ba5-e797-4260-95d1-fba7849c9800` | `LIV-STY-CEDARWOOD-INCENSE (renamed “Cedarwood”)` | `bc4ab8d1-edc0-4d84-92f1-2e3d0f9027b6` | `EXT-ICHI-CWD-OS` | 1 |
| Osmanthus Incense | `21c9ae18-bd23-425d-9337-e680df88f159` | `LIV-STY-OSMANTHUS-INCENSE (renamed “Osmanthus”)` | `7178859d-b627-4873-bfaf-44b25c8e641f` | `EXT-ICHI-OST-OS` | 1 |
| Riley Navy | `dddc260b-d668-4839-9169-24d76d9bd6a4` | `LIV-STY-RILEY-GREY-MELANGE (renamed “Riley”)` | `9351f140-cced-4ab2-b872-1a1ac65b87b6` | `LIV-RLY-NV` | 1 |
| Riley Navy | `dddc260b-d668-4839-9169-24d76d9bd6a4` | `LIV-STY-RILEY-GREY-MELANGE (renamed “Riley”)` | `fbd462f0-a762-49b7-99af-5fcbd85d4130` | `LIV-STY-RILEY-NAVY` | 1 |
| Rose & Green Incense | `74678a6f-d6e7-4bca-881c-05d061bf1c7b` | `LIV-STY-ROSE-GREEN-INCENSE (renamed “Rose”)` | `34783265-5071-458d-90e2-dc65c884abec` | `EXT-ICHI-RSG-OS` | 1 |
| Stone Dove Linen | `f019a05b-aa03-4b4c-a06e-1e935b20f6d7` | `LIV-STY-STONE-ASH-LOOSE (renamed “Stone”)` | `056fff60-0849-4f76-929e-de1b1193080e` | `LIV-STN-DVLN` | 1 |
| Stone Dove Linen | `f019a05b-aa03-4b4c-a06e-1e935b20f6d7` | `LIV-STY-STONE-ASH-LOOSE (renamed “Stone”)` | `79b387f2-6344-4109-af67-22ef6260ebff` | `LIV-STN-MLLN` | 1 |
| Tuck Black | `6afc6c65-04e3-40a6-ba57-5f516a6b826e` | `LIV-TCK-BK (renamed “Tuck”)` | `cec38579-14bd-4589-a17e-e4c68487c5c1` | `LIV-TCK-BLCK` | 1 |
| Ylang Ylang Incense | `92eed3fd-e38d-47c0-87a2-02c9deddee3c` | `LIV-STY-YLANG-YLANG-INCENSE (renamed “Ylang Ylang”)` | `fd35cf68-be18-45a0-9cd5-51724fb6890e` | `EXT-ICHI-YLY-OS` | 1 |

### C. Vintage — distinct garments, none canonical

`LIV-STY-L-L-BEAN-FLANNEL-SHIRT-M`, `LIV-STY-L-L-BEAN-FLEECE-LINED-FLANNEL-OVERSHIRT-M`,
`LIV-STY-L-L-BEAN-SHIRT-L`, `LIV-STY-RALPH-LAUREN-BLAKE-SHIRT-L`,
`LIV-STY-RALPH-LAUREN-SHIRT-XL`, `LIV-STY-RALPH-LAUREN-YARMOUTH-SHIRT-L`.

You filtered by SKU prefix and these start with `LIV-`, but they are not Livid
product: they are second-hand one-of-one garments that the importer wrongly gave
a `LIV-STY-` parent. Six `VN-ONLN-` Ralph Lauren shirts in XL are six different
shirts that happen to share a name. **None of the duplicated colours is
canonical — keep every `colorway_id`.** The `LIV-STY-*` parents will stop being
created; the garments themselves stay exactly as they are.

### D. Novac and Nox — please read these as a Threadflow problem

`LIV-M-NVC` / `LIV-M-NVC-RGLN-CT-002` and `LIV-M-NX` / `LIV-M-NX-001` are the
only two cases where **both** styles come from Threadflow, with live SS27
colourways on each side. Our sync rewrites `styleId` from Threadflow's structure
on every pull, so anything we did here would be undone on the next one — the same
conclusion as the Barnes / Faded Porcelain case on 15 September. We are raising
it upstream. Until it is settled, both styles stay as they are.

## Two things we need from you

**1. Can a style be withdrawn?** You asked us to send a retiring style with
`channels.loom = false` rather than dropping it. We cannot: `channels` exists on
the colourway, never on the style — there is no style-level channel object in the
payload at all. And in a re-nest no colourway goes dark; they all still arrive,
just under a different block. So a retired style simply stops appearing, and we
expect it to be left behind as an empty shell.

Across the whole repair that is roughly **1,000 style records**, all of them
already in Loom. So:

- Does your upsert accept a style block with `channels: { loom: false }` and an
  empty `colorways` array? If it does, we will emit exactly that and you will
  never see an orphan.
- If not, do you prune a style once its last colourway has moved away, or should
  we send you the list of retired `style_id`s to remove?

**2. Please confirm the re-nest itself.** Your note says a colourway "belongs to
whichever style block it arrives under" and that every push rewrites it. We read
that as: the same `colorway_id` arriving under a different `style_id` moves, and
does not duplicate. Before we run the bulk change we will apply and push **one
cluster only** — seven Archive colourways — so both of us can look at the result.

## What you will see

- Mode `data`, one push per season, mostly Archive. We are not using `full`: it
  is readiness-gated at our end and silently skips colourways, which would leave
  half the re-nest behind.
- Every moved colourway keeps its `colorway_id`, its variants and its barcodes.
- Where two colours genuinely duplicate after the merge, we resolve them through
  our existing colourway merge, which archives the loser — so it reaches you as
  `channels.loom = false` and answers "which id is canonical" explicitly.
- A fresh `event_id` on every push, including retries.
