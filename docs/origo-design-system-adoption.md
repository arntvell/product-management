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

### Phase 2 — primitives

Restyle the 17 shadcn primitives in `src/components/ui` to the spec, keeping
Radix behaviour. The design-system `ui/*.tsx` files are the **visual reference**,
not a drop-in replacement: they have no focus trap, no combobox, no multi-select
and a native `<select>`, all of which our grids depend on.

Then port the components shadcn does not have, from `_front-end-design-system/ui`:
`Panel`, `PageHeader`, `Page`, `StatGroup`/`Stat`, `KeyValue`, `StatusBadge`,
`Stepper`, `FilterChip`, `Breadcrumb`, `BulkBar`, `Notice`, `Progress`,
`Completeness`, `ChannelStatus`, `EmptyState`, `Drawer`, `ProductCell`, `Thumb`,
plus `formatNOK` / `formatPercent` into `src/lib/format.ts`.

Icons: keep `lucide-react` (far larger set, already a dependency) but wrap it so
every icon renders at `strokeWidth={1.5}`, square caps, 16px inline / 18px in nav.

### Phase 3 — shell

`AppShell` = 232px ecru sidebar + 56px top bar + scrolling main. Fold the two
nav systems (`layout/header.tsx` and `catalog/catalog-nav.tsx`) into one sidebar,
keeping catalog-nav's existing grouping as the sections: primary work, product
settings, data repair. Counts on nav items show work waiting.

### Phase 4 — grids

Our tables are hand-rolled flex rows with `role="row"`/`role="cell"` plus
`@tanstack/react-virtual` (`products/product-table.tsx` is canonical, 5 grids
total). **Keep the virtualization** — the spec's `<table>` cannot replace it.
Adopt the visual rules only: ink rule under the header, hairline between rows,
no zebra, no vertical rules, `bg-hover` on hover, `bg-selected` on selected and
edited rows, `tabular-nums`, numeric columns right-aligned, `ProductCell` as the
standard first column.

**Density:** 48px rows and 40px header rows on list and detail screens; a
documented **36px compact variant for the bulk and variant editors only**, where
rows-per-screen is the point of the tool. Nothing else about those grids differs.

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
