# Saphir — re-nesting four collapsed colourways

2026-09-23. Cin7 snapshot: `snapshots/cin7_products.json`, 2026-09-17.
**STATE: DONE — applied in Origio and pushed to Loom, read back clean.**

## The defect

Same importer bug as vintage and the Red Wing care split
(`red-wing-care-split.md`): Cin7 puts the size last in a SKU, so the importer
stripped the trailing segment and grouped on the rest. For Saphir that segment
is never a size. It is either the **article** or the **colour**, and the two
need different fixes:

| parent | held as "sizes" | really | fix |
|---|---|---|---|
| `EXT-ZP` "Spreading brush white bristles" | CBR, CTN, RNV, SBWB, SIWS, WSM | 6 unrelated articles | a style each |
| `EXT-ZP-1925` "Crème 1925 Light Brown" | BL, DB, LB, MB, NT | 1 cream, 5 colours | 1 style, 5 colourways |
| `EXT-ZP-PB` "Polishing brush white bristles" | BK, WH | 1 brush, 2 bristle colours | 1 style, 2 colourways |
| `EXT-SP-PT1925` "Pate De Luxe - Dark Brown" | DB, MB, NT | 1 wax, 3 colours | 1 style, 3 colourways |

Every parent had taken its name from one child. The colour families therefore
re-use the parent's **existing style row**, which keeps its id so Loom updates
it in place, and that style is renamed to the product name ("Crème 1925",
"Polishing brush", "Pate De Luxe"). The Spreading brush keeps the `EXT-ZP` style,
which was already named after it. That avoids leaving an empty style shell in Loom.

Out of scope, nesting already correct: `EXT-SP` (Omni'Nettoyant),
`EXT-SP-SPLO` (Sport Loisir Outdoor), `EXT-SP-SPTBR` (Spatula Brush). All
four parents were `CIN7_IMPORT` with no `threadflowId`, so no Threadflow sync
will re-parent them back.

## What was done

`node scripts/saphir-split/plan.mjs` → `snapshots/saphir-split-plan.json`, then
the vintage applier and pusher via `--plan=`.

- 16 variants moved (ids unchanged), each into its own colourway (SKU = variant
  SKU), size `OS`.
- 5 new styles (CBR, CTN, RNV, SIWS, WSM), 4 reused, 3 renamed.
- Colourway name is Cin7's full name ("Crème 1925 Black"), since Pio's picker
  shows it. `color` is set on the colour families ("Black", "Dark Brown"…).
- Each new colourway gets one CONTINUITY entry and its own Cin7 NOK MSRP
  (59–385 kr). The parents each held a single price.
- The parent's `fullDescription` and tags were carried to every colour in the
  three families. In `EXT-ZP` the description was the Spreading brush's, so it
  went to SBWB only. The other five articles have none.
- New styles inherit the parent style's `weightKg` 0.3 (a placeholder, not a
  measured weight).
- **Channels declared by the applier itself** in the same transaction: 32
  `ChannelPublication` rows (16 SHOPIFY + 16 SITOO), from each variant's own
  refs. This closes the gap Red Wing hit (see memory
  `origio-split-needs-channel-declare`), and no reconcile was needed.
- The 4 parents are empty and archived, and withdrawn in Loom.

### Applier and pusher changes (`scripts/vintage-split/`, uncommitted)

`apply.mjs` reads optional plan fields `styleName`, `renameStyle`,
`styleWeightKg`, `color`, `fullDescription`, `tags` and `declareChannels`.
Plans without them (vintage, Red Wing) behave as before.

`push.mjs` now sends new colourways that share the parent's style **last**.
Without that, the `EXT-ZP` dry run put the withdrawal in block 4 of 6, ahead of
the SIWS and WSM moves. Archiving cascades to Pio deletes for zero-stock SKUs
still under the parent, so the withdrawal has to be the last thing in the batch.

## Push result

| parent | job | moved | created | refused | itemErrors |
|---|---|---|---|---|---|
| `EXT-ZP-PB` | `cmue0fz9t00lxgq0g3bk5jkcp` | 2 | 0 | 0 | 0 |
| `EXT-SP-PT1925` | `cmue0gu0h00mvgq0gyw0zr221` | 3 | 0 | 0 | 0 |
| `EXT-ZP-1925` | `cmue0haqi00nygq0gu0mqu36i` | 5 | 0 | 0 | 0 |
| `EXT-ZP` | `cmue0hr9d00pigq0gsfxftpwr` | 6 | 0 | 0 | 0 |

`mode: data`, `season: archv`, `allow_variant_reparent`, explicit `sku` per
variant. All 16 came back in `pioReparentPending` as `renamed_only`. That is the
known success shape: Pio took the name and size, and the grouping id is retried
on the next product sync.

Read-back: `POST /identity` shows 16/16 SKUs and 16/16 barcodes resolving to
their own colourway, variant `OS`. `GET /products?style_id=` shows the 3 renamed
styles with their colours nested and the stock attached (e.g. Crème 1925 Black
30, Polishing brush white 35). The parents are archived at 0 stock.
`/styles?empty=true` contains none of these styles.

## Noted, not acted on

- `EXT-SP-OMNIT` has size label `OMNIT` and `EXT-SP-SPLO-NT` has `NT`. Both are
  one-size products with junk size labels. Nesting is fine.
- Cin7 holds articles that Origio does not: `EXT-SP-PT1925-BK` (Pate De Luxe
  Black) and `EXT-SP-SPLO-OKE-50ml` / `-150ml` (Oké spray, the two sharing one
  barcode).
- Pate De Luxe's style SKU is still `LIV-STY-PATE-DE-LUXE-DARK-BROWN`. Only the
  name was corrected, since Loom keys the style on id, not SKU.
- In Loom the withdrawn parents still read `shopify: true, sitoo: true`, same as
  the Red Wing parent. Harmless: they have no variants.
