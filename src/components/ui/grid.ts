// The grid vocabulary, in one place.
//
// Our tables are hand-rolled flex rows with ARIA roles plus
// @tanstack/react-virtual, because the spec's semantic <table> cannot carry
// tens of thousands of rows. The look is still §6's: an ink rule under the
// header, a hairline between rows, no zebra, no vertical rules, and a row that
// changes ground rather than gaining a border when you touch or select it.
//
// These are class strings, not components, so a grid adopts them without being
// restructured.

/** Sticky head: meta caps on paper, closed by the one ink rule in the table. */
export const gridHead =
  "sticky top-0 z-10 bg-paper border-b border-ink text-meta uppercase text-muted-foreground";

/** A body row. Hairline below, hover ground, no border of its own. */
export const gridRow =
  "border-b border-line transition-colors duration-150 ease-origo hover:bg-hover";

/** Selected — and edited, which §7 gives the same ground. */
export const gridRowSelected = "bg-selected hover:bg-selected";

/**
 * A cell holding an edit that is not saved yet.
 *
 * A rule, not a fill: §7 gives an edited row the `selected` ground, so a fill
 * would be the same ground a ticked row already has and the edit would vanish
 * inside its own selection. An outline sits on top of any ground and costs no
 * layout.
 */
export const dirtyCell = "outline outline-1 -outline-offset-1 outline-ink";

/** Numbers are tabular and right-aligned, always. §4 */
export const gridNumeric = "tabular-nums text-right";

/** §5: 48px rows where you are reading, 36px where you are editing in bulk
 *  and rows-per-screen is the point of the tool. */
export const GRID_ROW_HEIGHT = 48;
export const GRID_ROW_HEIGHT_COMPACT = 36;
