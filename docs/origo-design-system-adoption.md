# Origo — design system adoption

Origo is Livid's product master. Its UI follows the Livid Product Master design
system delivered in `_front-end-design-system/`.

**The spec is `_front-end-design-system/PRODUCT-MASTER-DESIGN.md`. Read it before
building any screen.** This file records what is binding, what has been done, and
what remains.

---

## What is binding, and what is reference

- **Binding:** §2 principles, §3 colour, §4 typography, §5 layout & spacing,
  §6 component contracts, §9 states & interaction, §10 copy, §11 don'ts.
- **Reference only:** §7 screen patterns. They describe a reference app, not
  Origo. Apply the *patterns* (stat group → needs-attention table, stepper for
  multi-step flows, bulk bar on selection) to the screens we actually have.
  Do not build Overview / Attributes / Season-pricing screens because §7 lists
  them.
- **Not buildable:** §8 roles. Auth is a single `APP_PASSWORD` in `middleware.ts`
  with no user records, so there is nobody to assign a role to. Revisit if real
  accounts land.

The spec's §1 says "follow this file exactly". That is overridden: we use the
system, we do not reproduce the reference app.

### The five principles, short

1. Quiet tool, loud data. Chrome is ink on ecru; products and numbers carry the screen.
2. Lines, not boxes. 1px hairlines and ink rules. One container (`Panel`). No cards in cards.
3. Shape + word, never colour. Status is a glyph and a label. Errors are inverted ink, not red.
4. One primary action per view, top right of the page header.
5. Show what blocks the push.

---

## Guard rails

The repo has **no test suite** — no test script, no spec files. The only
functional net is the typechecker plus someone looking at the screen. The work
is therefore paced to stay reversible:

- All front-end work lives on branch **`origo-design-system`**. `main` is
  untouched.
- Gate before every commit: `npx tsc --noEmit` clean, `npm run lint` no worse
  than the recorded baseline of **106 problems (64 errors, 42 warnings)** at
  `73113f3`, and the dev server compiling the touched routes.
- Phase 2 changes `className` strings only — never props, never Radix wiring —
  and commits per primitive, so any regression is bisectable to one component.
- **Phase 4 pauses for a hands-on check before it starts.** The five virtualized
  grids and the bulk editor's save/dirty/autosave path are load-bearing and
  recently worked on; typecheck cannot tell you they still behave.

If `tsc` reports a missing module under `.next/types` for a route that does not
exist, the generated types are stale from an older build: `rm -rf .next/types`
and let the dev server regenerate them.

---

## Phase 1 — token bridge (done)

The first commit on the branch. One change, no component edits. The whole app took on the palette, flat corners,
ecru ground and Forma DJR type while every existing component kept working.

- `src/app/globals.css` rewritten. The nine palette tokens (`--ink`, `--ecru`,
  `--paper`, `--offwhite`, `--line`, `--subtle`, `--hover`, `--selected`,
  `--cyan`) are defined once, exposed to Tailwind as `bg-ink`, `border-line`,
  `bg-selected` …, and shadcn's semantic names are aliased onto them.
- The Tailwind v3 preset in `_front-end-design-system/tailwind.preset.js` is
  **not usable as-is** — we are on Tailwind v4, which is CSS-first. Its contents
  live in the `@theme inline` block instead. Do not add a `tailwind.config.js`.
- Type scale: `text-meta` (12/16 +0.08em), `text-body` (14/20), `text-section`
  (22/24), `text-page` (34/32) — plus `font-display` and `font-sans`.
- `--radius: 0`. `rounded-sm/md/lg/xs` resolve to 0; plain `rounded` and
  `rounded-t/b/l/r` are hardcoded in the shadcn compat layer, so a small
  `@layer utilities` override in `globals.css` flattens them until the
  enforcement phase. `rounded-full` survives for the one pill (`FilterChip`).
- The `.dark` token block is gone. The spec is light-only, and the dark tokens
  were unreachable anyway — `next-themes` was only ever imported by
  `ui/sonner.tsx` and no `ThemeProvider` was mounted. The
  `@custom-variant dark (&:is(.dark *))` line **must stay**: it pins `dark:` to a
  class nothing ever gets. Without it Tailwind v4 falls back to
  `prefers-color-scheme` and the 117 `dark:` utilities still in components fire
  on any machine set to dark.
- Focus ring, `::selection` and link underline rules from `tokens.css` moved into
  the base layer. **Never remove the cyan focus ring.**

### The shadcn → design-system alias map

| shadcn name | Origo token | Note |
|---|---|---|
| `background` | ecru | app ground |
| `foreground`, `card-foreground`, `popover-foreground` | ink | |
| `card`, `popover` | paper | |
| `primary` | ink | `primary-foreground` → offwhite |
| `secondary`, `muted` | hover | 187 `bg-muted` uses stay correct |
| `muted-foreground` | #5E5D58 | **this is the spec's `muted`** — 608 uses, already right |
| `accent` | selected | |
| `destructive` | ink | errors are inverted ink, never red |
| `border`, `input` | line | |
| `ring` | cyan | |

Error states are ink-only until phase 2. `destructive → ink` means the 51
`text-destructive` messages now read as plain body text and the 21
`bg-destructive` buttons look identical to primary. That is the spec's intent
(§3: errors are inverted ink, never red) but only half of it — the alert glyph
that distinguishes them arrives with `StatusBadge` and `Notice`.

Vocabulary note: the spec's `muted` (secondary text) is our `muted-foreground`.
The spec's `hover` is our `muted` as a background. New components should use the
DS names (`text-muted-foreground`, `bg-hover`, `bg-selected`) — both resolve to
the same values.

### Fonts and marks

- `FormaDJRLivid-Regular.woff2` (display) and `FormaDJRLividText-Regular.woff2`
  (text) are self-hosted from `src/app/fonts/` via `next/font/local`, exposed as
  `--font-forma-display` / `--font-forma-text`. Geist is gone.
- One weight, 400. **No bold anywhere.** Hierarchy is size, case and family.
- `public/livid-mark.svg` is the Livid wordmark with `fill="currentColor"`, so
  one asset serves ink, offwhite and cyan. The supplied `Obsidian.svg` was filled
  offwhite (same as `Offwhite.svg`), so there was no black variant to ship.
- Product name is **Origo** (`metadata.title`, header, login).
- Housekeeping in the same commit: `_front-end-design-system/` is gitignored (it
  carries desktop `.otf` files and a zip that should not leave the machine) and
  excluded from typecheck in `tsconfig.json`, the way `_scratch` already was.

---

## What remains

## Phase 2 — primitives (done)

All 17 shadcn primitives restyled, class strings only — no props, no Radix
wiring — so every menu, dialog, combobox and multi-select behaves as before.
One commit per primitive or coherent group, so a regression bisects. The single
exception to "class strings only" is the checkbox reading `checked` to choose
between a tick and the indeterminate minus: a prop read, not a prop change.

- **Button** keeps every variant and size name (53 files import it) and maps
  each onto a system appearance. `destructive` renders as the ink-outlined
  secondary: §9 puts the weight of a destructive action on the confirmation
  that follows, and §3 leaves no red to use. Case is applied in CSS so call
  sites keep their sentence-case strings. `inverse` is new, for `BulkBar`.
- **Form controls** — paper ground, hairline that goes ink on hover and focus,
  labels as meta caps, square checkbox with the indeterminate minus from §6.
  Invalid is an ink border.
- **Badge** is metadata only — season, category, channel — and lost the pill.
  Status belongs to `StatusBadge`.
- **Overlays** lost radius, shadows, `font-medium`, the stray type sizes, the
  `zoom-in-95` bounce §9 rules out, and their `dark:` utilities. The only
  surviving shadow is `shadow-overlay`, on surfaces that float.
- **Focus** is declared once, in the base layer, in cyan. Every component's own
  ring is gone — eleven declarations of one rule is how it eventually differs
  in one of them.
- **Icons**: `lucide-react` stays (larger set, already a dependency). The §6
  line quality — 1.5 stroke, square caps, mitred joins — is one rule in
  `globals.css` keyed off the `lucide` class, not a prop at every call site.
- **Toaster** takes the palette and drops `next-themes`, which was the last
  file importing it.

Added, as new files that nothing yet imports: `Panel`, `PageHeader`, `Page`,
`Stat`/`StatGroup`, `KeyValue`, `StatusBadge`, `Notice`, `Progress`,
`Completeness`, `EmptyState`, `Tabs`, `Stepper`, `FilterChip`, `Breadcrumb`,
`BulkBar`, `ProductCell`/`Thumb`, `ChannelStatus`, `Drawer`, and
`src/lib/format.ts`.

Two deliberately depart from the design system's own sources: `StatusBadge`
draws its five glyphs inline (they are the status language, not decoration),
and `Drawer` is built on our `Sheet` so Radix provides the focus trap, scroll
lock and aria wiring their hand-rolled panel lacks.

## Phase 3 — shell (done)

`AppShell` is a 232px ecru sidebar, a 56px top bar and a scrolling `main`.
`layout/header.tsx` and `catalog/catalog-nav.tsx` are gone; `nav-model.ts` is
now the single list of destinations.

- The catalogue nav's grouping survives as the sidebar sections — Catalogue,
  Product settings, Data repair — with a fourth, **Shopify**, for the screens
  this app used to be. **All 25 destinations are preserved**, asserted by
  diffing the href sets rather than by eye. Before this, a catalogue sub-page
  showed neither its siblings nor any way back.
- **The Shopify section is a safety boundary, not a tidy-up.** `/` (Products),
  `/groups`, `/media` and `/models` read and write the Shopify store directly:
  an edit there is live immediately, with no push step. The section carries
  "Writes to the live store" and the filled dot that means *live* in
  `StatusBadge`, and the top bar repeats the marker so it sits on the screen
  being edited, not only in the nav.

  **Models belongs in that section.** It writes Shopify metaobjects
  (`METAOBJECT_CREATE`/`UPDATE`/`DELETE`) — reference data rather than a
  listing, so the blast radius differs, but it is a live write. Do not carve it
  out as local.
- **The top bar is 56px for a reason.** Nine pages are sized
  `h-[calc(100vh-56px)]` against the old header. Any other height would have
  left every one of them off by the difference. Keep it at 56px, or change
  those nine in the same commit.
- `main` scrolls rather than the document. All five virtualized tables scroll
  their own inner container and measure it by ref — none uses
  `useWindowVirtualizer` — so none is affected. **Check this again before
  adding a sixth grid.**
- `New product` moves to the top bar, reachable from every screen; it used to
  exist only on `/catalog`.
- `/login` renders without chrome.
- Nav `count` is reserved for work waiting (missing data, sync errors) per §6.
  It is deliberately unset until there is a real figure behind it.
- The Livid mark is an inline component, not `next/image`. An external SVG
  renders in its own document and cannot inherit colour, so `currentColor` was
  resolving to black by luck — and `next/image` sets `color:transparent` on the
  element besides. Inline, it takes ink on ecru and offwhite on ink.
  `public/livid-mark.svg` stays as the source asset.

## Phase 4 — grids (done)

The five grids — products, bulk editor, prices, collections, media — keep their
structure entirely: still hand-rolled flex rows with ARIA roles, still
virtualized against their own scroll container. Only class strings and row
heights changed, in two separate commits so the density half can be reverted
without losing the visual half.

- `src/components/ui/grid.ts` holds the shared vocabulary: `gridHead`,
  `gridRow`, `gridRowSelected`, `gridNumeric`, and the two row heights. **Use
  these in a new grid rather than restyling one by hand** — the selected row
  had been three different blues in three files before this.
- The look is §6's: ink rule closing the header, hairline between rows, no
  zebra, no vertical rules, ground change rather than colour on hover and
  selection.
- Density: **48px** on reading screens (products, prices, media), **36px** in
  the bulk editor, where rows per screen is the point of the tool. Both come
  from `grid.ts`.
- Products and media had 32px thumbnails inside 8px padding — 48px of content
  in a 40px row. The new height fixes a clip that predates this work.
- **Collections keeps its 63px.** It is a semantic `<table>` whose rows are
  content-sized, and the virtualizer's `estimateSize` must match what they
  actually measure. Do not change that number alone.
- The bulk editor's cell keeps an outline on `focus`, not `focus-visible`: in a
  dense grid you have to see which cell you just clicked. It is cyan, which is
  the one use §3 allows.

### Phase 5 — screens

Highest-traffic first, following §7 as a pattern library rather than a blueprint.

### Phase 6 — enforcement

Only once components are migrated: set the Tailwind namespaces to `initial` so
off-palette utilities genuinely stop existing, then add a CI grep guard.

Outstanding at the time of writing:

| To remove | Count |
|---|---|
| `text-xs` / `text-sm` / `text-lg` / `text-xl` / `text-2xl` / `text-base` → the four DS sizes | 938 |
| `rounded-*` utilities (incl. 64 `rounded-full`, 128 plain `rounded`) | 447 |
| `font-medium` / `font-semibold` | 377 |
| off-palette colours (amber, green, rose, blue, yellow…) | 340 |
| `dark:` utilities (inert, but dead weight) | 117 |

---

## Feedback policy

- **Sonner stays** for asynchronous outcomes that land after you have moved on —
  channel pushes, imports, long jobs. 201 `toast.*` calls exist today, mostly
  these.
- **Form saves do not toast.** Per §9: the save button is disabled until dirty,
  and after saving you show an inline `Notice` or "Saved" meta text. No stacking
  toasts for work the user is watching happen.

## Copy

British spelling, Norwegian number formatting. Buttons are UPPERCASE verbs.
`formatNOK(2500)` → `2 500,- NOK`; `formatPercent(0.523)` → `52,3 %`; dates
`DD.MM.YYYY`. No exclamation marks, no emoji. Errors say what and how to fix.
