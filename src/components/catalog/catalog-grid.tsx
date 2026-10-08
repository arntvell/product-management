"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { PinIcon, PinOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {  gridHead,
  gridRow,
  gridRowSelected,
  GRID_ROW_HEIGHT_COMPACT,
  dirtyCell,
} from "@/components/ui/grid";
import {
  PRODUCT_STATUSES,
  PUBLISH_CHANNELS,
  PUBLISH_CHANNEL_LABELS,
  type PublishChannelKey,
} from "@/lib/master/fields";
import { channelProductTitle } from "@/lib/master/channel-title";
import { toPlainText } from "@/lib/master/rich-text";
import { catalogImageSrc } from "@/lib/catalog-image";
import { usePages } from "@/hooks/use-pages";
import { useCollections } from "@/hooks/use-collections";
import { useModels } from "@/hooks/use-models";
import { CellPanel, type CellPanelTarget } from "./cell-panel";
import { CopyFieldsDialog } from "./copy-fields-dialog";
import type { CopyableField } from "@/lib/master/copy-fields";
import type { GridRow } from "@/lib/master/queries";
import type { BulkChange, EditLayer } from "@/lib/master/edit";

type View = EditLayer | "REFERENCES";

/** A product the till sells in more sizes than the master holds. */
interface UntouchedSizes {
  colorwaySku: string;
  inMaster: number;
  inSitoo: number;
}

/** What one channel did, in a fan-out push. */
interface ChannelPushReport {
  channel: string;
  /** Colorways, for every channel, so the three numbers compare. */
  attempted: number;
  ok: number;
  issues: string[];
  /** What the colorway count cannot say — Sitoo's per-size row tally. */
  detail?: string;
}

// Reference columns (References view). Single = Shopify-GID select; multi =
// master colorway id list (count + fill-down/clear; detailed edit in the editor).
const REF_SINGLE: { key: string; label: string; src: "care" | "fitguide" | "collection" | "model"; width: number }[] = [
  { key: "carePageId", label: "Care page", src: "care", width: 150 },
  { key: "fitguidePageId", label: "Fit guide", src: "fitguide", width: 150 },
  { key: "recommendedCollectionId", label: "Collection", src: "collection", width: 150 },
  { key: "modelInfoId", label: "Fit model", src: "model", width: 130 },
];
const REF_MULTI: { key: keyof GridRow["refs"]; label: string; width: number }[] = [
  { key: "sameProduct", label: "Same product", width: 120 },
  { key: "styleWith", label: "Style with", width: 120 },
  { key: "styleWithUnisexHerre", label: "SW Herre", width: 110 },
  { key: "styleWithUnisexDame", label: "SW Dame", width: 110 },
];

interface ColDef {
  key: string;
  label: string;
  width: number;
  kind: "status" | "tags" | "text";
  split: boolean; // channel-overridable
}

const COLUMNS: ColDef[] = [
  // "Shopify status", not "Status", because that is whose it is.
  //
  // Shopify owns this field in practice and the code already concedes it: the
  // push refuses to overwrite a live ACTIVE and tells you to change it in
  // Shopify directly, and Refresh reads it back. Calling it Status invited the
  // reading that the master decides — which it does not, and which made 2,288
  // products look like drafts while they were selling.
  //
  // It is not ONLY Shopify's: lookup.ts, add-size.ts and variant-barcodes.ts all
  // read ARCHIVED as "this product is retired" regardless of channel. So the
  // tooltip says what the label cannot.
  {
    key: "status",
    label: "Shopify status",
    width: 118,
    kind: "status",
    split: false,
  },
  { key: "tags", label: "Tags", width: 160, kind: "tags", split: true },
  { key: "vendor", label: "Vendor", width: 118, kind: "text", split: false },
  { key: "productType", label: "Type", width: 104, kind: "text", split: false },
  { key: "shortDescription", label: "Short desc", width: 200, kind: "text", split: true },
  { key: "fullDescription", label: "Full desc", width: 220, kind: "text", split: true },
  { key: "details", label: "Details", width: 200, kind: "text", split: true },
  { key: "styleTagline", label: "Tagline", width: 170, kind: "text", split: true },
  { key: "styleName", label: "Style name", width: 150, kind: "text", split: true },
];

/**
 * Fields you write prose into. These get a read-only cell that opens the side
 * panel; a 200px single-line input is not somewhere anyone can write a product
 * description. The short attributes (vendor, type, status, tags) stay inline.
 */
const LONG_TEXT_FIELDS = new Set([
  "shortDescription",
  "fullDescription",
  "details",
  "styleTagline",
]);

/** Human label for every writable key, for the copy-down field picker. */
const FIELD_LABELS: Record<string, string> = {
  swatchHex: "Swatch",
  priceNok: "NOK price",
  name: "Name",
  status: "Shopify status",
  ...Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])),
  ...Object.fromEntries(REF_SINGLE.map((c) => [c.key, c.label])),
  ...Object.fromEntries(REF_MULTI.map((c) => [c.key, c.label])),
};

/**
 * One letter per channel for the Channels column.
 *
 * Written out rather than taken from the channel name: Shopify and Sitoo both
 * start with S, so a first initial would have shown the same badge for the
 * webshop and the till — on a column whose entire job is telling them apart.
 * P is for the POS.
 */
const CHANNEL_INITIAL: Record<PublishChannelKey, string> = {
  SHOPIFY: "S",
  LOOM: "L",
  SITOO: "P",
};

/** Column headers that need a sentence the label has no room for. */
const COLUMN_HINTS: Record<string, string> = {
  status:
    "Shopify's product status. Shopify is the authority: a push never overwrites a live ACTIVE, and Refresh from Shopify reads it back. ARCHIVED also retires the product for Look-up and Add size.",
  fullDescription:
    "Shown as text. Most of these carry HTML from the Cin7 import — paragraphs, bold and links that the storefront renders — so the markup is kept and only hidden here.",
};

/** Fixed columns with a sort control. Title is derived, channels and swatch are not worth ordering. */
const SORTABLE_FIXED = new Set(["name", "priceNok", "media"]);
/** "10" after "9", and case-insensitive, so a sort reads the way a person expects. */
const SORT_COLLATOR = new Intl.Collator("nb", { numeric: true, sensitivity: "base" });

const SELECT_W = 36; // row-select checkbox column
const LABEL_W = 320; // frozen-ish left block (img + style + colorway)
const ROW_H = GRID_ROW_HEIGHT_COMPACT;

/** How long the grid waits after the last edit before autosaving. */
const AUTOSAVE_IDLE_MS = 1500;

function dkey(id: string, layer: EditLayer, field: string) {
  return `${id}|${layer}|${field}`;
}

// Always-visible columns (every layer), left of the layer-specific columns.
const FIXED_COLS: { key: string; label: string; width: number }[] = [
  // Name is layer-independent — there is one name, not a Shopify one and a Loom
  // one — so it sits with the other always-visible columns rather than in a
  // view. Title beside it is derived and read-only: it is what Shopify and the
  // till will show, and seeing it is what stops a half-rename going out.
  { key: "name", label: "Name", width: 190 },
  { key: "title", label: "Title", width: 190 },
  // Where this product lives. The fact the channel toggle used to obscure: a
  // product is not "a Shopify product" or "a Sitoo product" — four of the five
  // Tarvas shoes are on all three at once, which is why this is a column saying
  // what is true rather than a mode asking you to choose.
  { key: "channels", label: "Channels", width: 92 },
  { key: "swatchHex", label: "Swatch", width: 76 },
  { key: "priceNok", label: "NOK", width: 84 },
  { key: "media", label: "Media", width: 78 },
];
/** Width by key, so adding a column cannot silently shift another one's cell. */
const FIXED_WIDTH: Record<string, number> = Object.fromEntries(
  FIXED_COLS.map((c) => [c.key, c.width])
);

/**
 * Which workflow this grid is serving.
 *
 * "seasonal" the Livid editor at /catalog/edit, unchanged: season tabs, drops,
 *            carry-over, and a price column that waits for a season.
 * "external" vintage and the resold brands at /catalog/external. The season is
 *            pinned to CONTINUITY because that is where 3,648 of the 3,674 live
 *            and an external has no season in any meaningful sense, so the tabs,
 *            the drop filter and the carry-over filter are all answers to
 *            questions nobody asks here — and the price column is simply on.
 *
 * One grid rather than two: the editing, pasting, copy-down and autosave are the
 * same work, and a fork would be two places to fix the next bug in.
 */
export type GridScope = "seasonal" | "external";

export function CatalogGrid({
  initialRows,
  seasons,
  season,
  seasonId,
  colorwayOptions,
  scope = "seasonal",
  title,
  note,
}: {
  initialRows: GridRow[];
  seasons: { code: string }[];
  season?: string;
  seasonId?: string;
  colorwayOptions: { id: string; label: string }[];
  scope?: GridScope;
  /** Page heading. Defaults to the seasonal editor's. */
  title?: string;
  /** One line under the toolbar, for anything the scope has to explain. */
  note?: string;
}) {
  const seasonal = scope === "seasonal";
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [view, setView] = useState<View>("BASE");
  const [dirty, setDirty] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [droppedFilter, setDroppedFilter] = useState<"all" | "active" | "dropped">("all");
  const [filters, setFilters] = useState({
    vendor: "",
    productType: "",
    gender: "",
    status: "",
    source: "",
    needs: "",
    drop: "",
    origin: "",
    channel: "",
  });
  const [saving, setSaving] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  // The debounced save reads the pending map through a ref so it does not need
  // to be rebuilt (and reschedule itself) on every keystroke.
  const dirtyRef = useRef(dirty);
  // Read through a ref for the same reason the dirty map is: the debounced save
  // must not be rebuilt every time a row changes.
  const rowsRef = useRef<GridRow[]>(initialRows);
  /** True when every row can say which season its price belongs to. */
  const rowsHaveOwnSeason = initialRows.every((r) => r.priceSeasonId);
  const [panel, setPanel] = useState<CellPanelTarget | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Live registry of rendered cell inputs (rowIndex:field -> element) for
  // keyboard navigation across the virtualized grid.
  const cellRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement>>(new Map());
  // Row the user last focused — the source for column fill-down.
  const activeRowIdRef = useRef<string | null>(null);

  // References view edits land on the BASE layer (references aren't channel-split).
  const isRefs = view === "REFERENCES";
  const layer: EditLayer = isRefs ? "BASE" : (view as EditLayer);
  const isBase = view === "BASE";
  dirtyRef.current = dirty;
  rowsRef.current = rows;

  const { carePages, fitguidePages } = usePages();
  const { collections } = useCollections();
  const { models } = useModels();
  const refOptions = useMemo(
    () => ({
      care: carePages.map((p) => ({ id: p.id, label: p.title })),
      fitguide: fitguidePages.map((p) => ({ id: p.id, label: p.title })),
      collection: collections.map((c) => ({ id: c.id, label: c.title })),
      model: models.map((m) => ({ id: m.id, label: m.fields.name || m.handle })),
    }),
    [carePages, fitguidePages, collections, models]
  );

  const columns = isBase ? COLUMNS : COLUMNS.filter((c) => c.split);
  // Columns the viewer chose to hide. Per browser, per page — a convenience,
  // not shared state. Hidden columns are also out of keyboard order and the
  // copy-down picker, so "the columns I work with" means one thing.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set());
  const hiddenKey = `origo:catalog-grid:${scope}:hidden-columns`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(hiddenKey);
      if (raw) setHiddenCols(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage unavailable: every column shows.
    }
  }, [hiddenKey]);
  const updateHiddenCols = (next: Set<string>) => {
    setHiddenCols(next);
    try {
      localStorage.setItem(hiddenKey, JSON.stringify([...next]));
    } catch {
      // Not remembered, but still applied for this visit.
    }
  };
  const shownColumns = columns.filter((c) => !hiddenCols.has(c.key));
  const shownRefSingle = REF_SINGLE.filter((c) => !hiddenCols.has(c.key));
  const shownRefMulti = REF_MULTI.filter((c) => !hiddenCols.has(c.key as string));
  /** The product block and the fixed columns can be hidden like any other. */
  const shown = (key: string) => !hiddenCols.has(key);
  const shownFixed = FIXED_COLS.filter((c) => shown(c.key));

  // Frozen columns: pinned to the left, after the checkbox, while the rest
  // scroll sideways. Per browser, per page, like the hidden set. The product
  // block is frozen until someone unpins it — a row nobody can name is not
  // worth editing.
  const [frozenCols, setFrozenCols] = useState<Set<string>>(() => new Set(["__label"]));
  const frozenKey = `origo:catalog-grid:${scope}:frozen-columns`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(frozenKey);
      if (raw) setFrozenCols(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage unavailable: the default stands.
    }
  }, [frozenKey]);
  const toggleFrozen = (key: string) => {
    const next = new Set(frozenCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFrozenCols(next);
    try {
      localStorage.setItem(frozenKey, JSON.stringify([...next]));
    } catch {
      // Applied for this visit only.
    }
  };

  // Every column of this view, left to right, with its width.
  const naturalCols: { key: string; width: number }[] = [
    ...(shown("__label") ? [{ key: "__label", width: LABEL_W }] : []),
    ...shownFixed.map((c) => ({ key: c.key, width: c.width })),
    ...(isRefs
      ? [...shownRefSingle, ...shownRefMulti].map((c) => ({ key: c.key as string, width: c.width }))
      : shownColumns.map((c) => ({ key: c.key, width: c.width }))),
  ];
  const frozenOrder = naturalCols.filter((c) => frozenCols.has(c.key));
  const frozenLeft = new Map<string, number>();
  {
    let left = SELECT_W;
    for (const c of frozenOrder) {
      frozenLeft.set(c.key, left);
      left += c.width;
    }
  }
  const anyFrozen = frozenOrder.length > 0;

  /**
   * A cell's placement. Frozen cells move left with flex `order` — the markup
   * keeps its natural order — and stick with `position: sticky`, on an opaque
   * ground so the scrolling cells pass beneath them. The edited-cell outline is
   * unaffected; the row's hover tint is not drawn on a frozen cell.
   */
  function place(key: string, width: number, rowSelected = false, header = false): React.CSSProperties {
    if (key === "__select")
      return anyFrozen
        ? {
            width,
            order: 0,
            position: "sticky",
            left: 0,
            zIndex: header ? 4 : 3,
            background: rowSelected ? "var(--selected)" : "var(--paper)",
          }
        : { width, order: 0 };
    const left = frozenLeft.get(key);
    if (left === undefined) return { width, order: 1000 };
    return {
      width,
      order: 1 + frozenOrder.findIndex((c) => c.key === key),
      position: "sticky",
      left,
      zIndex: header ? 4 : 3,
      background: rowSelected ? "var(--selected)" : "var(--paper)",
    };
  }

  /** Header pin: freezes the column in place, or lets it scroll again. */
  function pinButton(key: string) {
    const on = frozenCols.has(key);
    return (
      <button
        type="button"
        title={on ? "Unfreeze this column" : "Freeze this column on the left"}
        onClick={() => toggleFrozen(key)}
        className={cn(
          "shrink-0 px-0.5 hover:bg-background hover:text-foreground",
          on ? "text-foreground" : "text-muted-foreground/40"
        )}
      >
        {on ? <PinIcon className="size-3" /> : <PinOffIcon className="size-3" />}
      </button>
    );
  }

  const totalWidth = SELECT_W + naturalCols.reduce((sum, c) => sum + c.width, 0);

  // Distinct attribute values for the filter dropdowns.
  const filterOptions = useMemo(() => {
    const distinct = (get: (r: GridRow) => string) =>
      [...new Set(rows.map(get).filter(Boolean))].sort();
    return {
      vendor: distinct((r) => r.vendor),
      productType: distinct((r) => r.productType),
      gender: distinct((r) => r.gender),
      source: distinct((r) => r.source),
      drop: distinct((r) => r.drop),
    };
  }, [rows]);

  function needsMatch(r: GridRow): boolean {
    switch (filters.needs) {
      case "noPrice":
        return !r.priceNok;
      case "noMedia":
        return r.mediaCount === 0;
      case "noShortDesc":
        return !(r.base.shortDescription ?? "").trim();
      case "noFullDesc":
        return !(r.base.fullDescription ?? "").trim();
      default:
        return true;
    }
  }

  /** What a column sorts on: the text a person reads in that cell. */
  function sortValue(r: GridRow, key: string): string {
    if (key === "__label") return `${r.styleName} ${r.name}`;
    if (key === "media") return String(r.mediaCount).padStart(6, "0");
    if (MULTI_REF_KEYS.has(key)) {
      try {
        const n = (JSON.parse(originalValue(r, "BASE", key) || "[]") as string[]).length;
        return n ? String(n).padStart(6, "0") : "";
      } catch {
        return "";
      }
    }
    if (SINGLE_REF_KEYS.has(key)) {
      const id = originalValue(r, "BASE", key);
      const src = REF_SINGLE.find((c) => c.key === key)!.src;
      return refOptions[src].find((o) => o.id === id)?.label ?? id;
    }
    const v = originalValue(r, layer, key) || (layer === "BASE" ? "" : originalValue(r, "BASE", key));
    return toPlainText(v).trim();
  }

  /** Header sort control: ↓ ascending, ↑ descending, then back to unsorted. */
  function sortButton(key: string) {
    const active = sort?.key === key ? sort.dir : null;
    return (
      <button
        title={
          active === "asc"
            ? "Sorted A→Z. Click for Z→A"
            : active === "desc"
              ? "Sorted Z→A. Click to clear the sort"
              : "Sort by this column"
        }
        onClick={() =>
          setSort(
            active === null ? { key, dir: "asc" } : active === "asc" ? { key, dir: "desc" } : null
          )
        }
        className={cn(
          "px-1 hover:bg-background hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {active === "desc" ? "↑" : "↓"}
      </button>
    );
  }

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (droppedFilter === "active" && r.dropped) return false;
      if (droppedFilter === "dropped" && !r.dropped) return false;
      if (filters.vendor && r.vendor !== filters.vendor) return false;
      if (filters.productType && r.productType !== filters.productType) return false;
      if (filters.gender && r.gender !== filters.gender) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.source && r.source !== filters.source) return false;
      // "__none" is the work queue: everything not yet placed in a drop.
      if (filters.drop === "__none" ? !!r.drop : filters.drop && r.drop !== filters.drop)
        return false;
      if (filters.origin && r.origin !== filters.origin) return false;
      // "__none" is everything on no channel at all — targeted nowhere, so no
      // edit here reaches a customer until someone chooses where it goes.
      if (
        filters.channel === "__none"
          ? r.channels.length > 0
          : filters.channel && !r.channels.includes(filters.channel)
      )
        return false;
      if (filters.needs && !needsMatch(r)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.styleName.toLowerCase().includes(q) ||
        r.colorwaySku.toLowerCase().includes(q)
      );
    });
    if (!sort) return filtered;
    // Sorted on SAVED values, never pending edits, so a row does not jump away
    // from under the cursor while it is being typed into. Blanks sort last in
    // both directions — an empty cell is not "smaller" than a filled one.
    const keyed = filtered.map((r) => ({ r, v: sortValue(r, sort.key) }));
    keyed.sort((a, b) => {
      if (!a.v && !b.v) return 0;
      if (!a.v) return 1;
      if (!b.v) return -1;
      const c = SORT_COLLATOR.compare(a.v, b.v);
      return sort.dir === "asc" ? c : -c;
    });
    return keyed.map((k) => k.r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, droppedFilter, filters, sort, layer, refOptions]);

  const droppedCount = rows.filter((r) => r.dropped).length;

  /** How many rows on screen the till holds — drives the Sitoo notice below. */
  const sitooRowsVisible = visibleRows.filter((r) =>
    r.channels.includes("SITOO")
  ).length;
  /** Selected rows on at least one channel — what a push would actually touch. */
  const pushableSelected = visibleRows.filter(
    (r) => selected.has(r.id) && r.channels.length > 0
  ).length;

  // Bulk operations target the selection when one exists, else all filtered rows.
  const targetRows = useMemo(
    () => (selected.size > 0 ? visibleRows.filter((r) => selected.has(r.id)) : visibleRows),
    [selected, visibleRows]
  );
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  function toggleRow(index: number, shiftKey: boolean) {
    const id = visibleRows[index].id;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedRef.current !== null) {
        const [lo, hi] = [lastClickedRef.current, index].sort((a, b) => a - b);
        const select = !next.has(id); // match the clicked row's resulting state
        for (let i = lo; i <= hi; i++) {
          const rid = visibleRows[i].id;
          if (select) next.add(rid);
          else next.delete(rid);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    lastClickedRef.current = index;
  }

  function toggleSelectAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map((r) => r.id)));
    lastClickedRef.current = null;
  }

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // Guard against losing unsaved edits on refresh / full-page navigation
  // (season pills, style/media links are real <a> navigations). Autosave
  // narrows this window to a second or two rather than closing it — a pending
  // or failed batch is still only in the browser.
  useEffect(() => {
    if (dirty.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty.size]);

  // ---- value resolution ----
  function originalValue(row: GridRow, l: EditLayer, field: string): string {
    if (l === "BASE") {
      if (field === "status") return row.status;
      if (field === "tags") return row.tags.join(", ");
      if (field === "vendor") return row.vendor;
      if (field === "productType") return row.productType;
      if (field === "swatchHex") return row.swatchHex;
      if (field === "priceNok") return row.priceNok;
      if (field === "name") return row.name;
      // single references
      if (field in row.refs && !Array.isArray(row.refs[field as keyof GridRow["refs"]]))
        return (row.refs[field as keyof GridRow["refs"]] as string) ?? "";
      // multi references (carried as JSON array string)
      if (field in row.refs)
        return JSON.stringify(row.refs[field as keyof GridRow["refs"]]);
      return row.base[field] ?? "";
    }
    return row.overrides[l][field] ?? "";
  }

  function cellValue(row: GridRow, l: EditLayer, field: string): string {
    const d = dirty.get(dkey(row.id, l, field));
    return d !== undefined ? d : originalValue(row, l, field);
  }

  function setCell(row: GridRow, field: string, value: string, atLayer: EditLayer = layer) {
    setDirty((prev) => {
      const next = new Map(prev);
      const key = dkey(row.id, atLayer, field);
      if (value === originalValue(row, atLayer, field)) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  // ---- keyboard navigation + spreadsheet paste ----
  // Editable cells in visual order, with the layer each writes to. Drives
  // Enter/Shift+Enter movement and multi-cell paste.
  const editableCols = useMemo(() => {
    const fixed = [
      { key: "name", kind: "text" as const, atLayer: "BASE" as EditLayer },
      { key: "swatchHex", kind: "text" as const, atLayer: "BASE" as EditLayer },
      { key: "priceNok", kind: "text" as const, atLayer: "BASE" as EditLayer },
    ].filter((c) => !hiddenCols.has(c.key));
    const all = isRefs
      ? [
          ...fixed,
          ...REF_SINGLE.filter((c) => !hiddenCols.has(c.key)).map((c) => ({
            key: c.key,
            kind: "select" as const,
            atLayer: "BASE" as EditLayer,
          })),
        ]
      : [
          ...fixed,
          ...(isBase ? COLUMNS : COLUMNS.filter((c) => c.split))
            .filter((c) => !hiddenCols.has(c.key))
            .map((c) => ({
              key: c.key,
              kind: (c.kind === "status" ? "select" : "text") as "text" | "select",
              atLayer: layer,
            })),
        ];
    // In screen order: frozen columns are drawn first, so a pasted block lands
    // in the columns it visibly lines up with.
    return [...all.filter((c) => frozenCols.has(c.key)), ...all.filter((c) => !frozenCols.has(c.key))];
  }, [isRefs, isBase, layer, hiddenCols, frozenCols]);

  /**
   * What copy-down can offer in this view, each with the layer it writes to.
   * Derived from editableCols so it can never drift from what the grid will
   * actually accept, plus the multi-value references, which copy verbatim as
   * JSON. Price is omitted without a season — it is season-scoped and there
   * would be nowhere to put it.
   */
  const copyDownFields = useMemo(() => {
    const base = editableCols
      // Price is offered whenever SOMETHING can say which season it belongs to:
      // the page's tab, or every row's own single season.
      .filter((c) => !(c.key === "priceNok" && !seasonId && !rowsHaveOwnSeason))
      .map((c) => ({
        key: c.key,
        label: FIELD_LABELS[c.key] ?? c.key,
        atLayer: c.atLayer,
      }));
    if (!isRefs) return base;
    return [
      ...base,
      ...REF_MULTI.filter((c) => !hiddenCols.has(c.key as string)).map((c) => ({
        key: c.key as string,
        label: c.label,
        atLayer: "BASE" as EditLayer,
      })),
    ];
  }, [editableCols, isRefs, seasonId, rowsHaveOwnSeason, hiddenCols]);

  const colIndexByField = useMemo(
    () => new Map(editableCols.map((c, i) => [c.key, i])),
    [editableCols]
  );

  function registerCell(rowIndex: number, field: string, el: HTMLInputElement | HTMLSelectElement | null) {
    const k = `${rowIndex}:${field}`;
    if (el) cellRefs.current.set(k, el);
    else cellRefs.current.delete(k);
  }

  // Focus a cell, scrolling it into view first so a virtualized (unmounted)
  // target row gets rendered before we try to focus it.
  function focusCell(rowIndex: number, field: string) {
    const clamped = Math.max(0, Math.min(rowIndex, visibleRows.length - 1));
    virtualizer.scrollToIndex(clamped, { align: "auto" });
    let tries = 0;
    const tryFocus = () => {
      const el = cellRefs.current.get(`${clamped}:${field}`);
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
      } else if (tries++ < 8) {
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }

  function onCellKeyDown(e: React.KeyboardEvent, rowIndex: number, field: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      focusCell(rowIndex + (e.shiftKey ? -1 : 1), field);
    }
  }

  // Paste a TSV block (from Excel/Sheets) starting at the focused cell: rows go
  // down, tab-separated columns go across (skipping selects and locked price).
  //
  // The tab is what identifies a spreadsheet block, not the newline. Prose has
  // newlines — a description copied out of a document nearly always does — and
  // treating those as row separators scattered one description across as many
  // products as it had paragraphs, overwriting each one. Anything without a tab
  // is a single value and goes to the browser's own paste.
  function onCellPaste(e: React.ClipboardEvent, rowIndex: number, field: string) {
    const text = e.clipboardData.getData("text");
    if (!text || !text.includes("\t")) return; // single value → default paste
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
    const startCol = colIndexByField.get(field) ?? 0;
    let count = 0;
    setDirty((prev) => {
      const next = new Map(prev);
      lines.forEach((line, r) => {
        const targetRow = visibleRows[rowIndex + r];
        if (!targetRow) return;
        line.split("\t").forEach((val, c) => {
          const col = editableCols[startCol + c];
          if (!col || col.kind === "select") return;
          if (col.key === "priceNok" && !seasonId && !rowsHaveOwnSeason) return;
          const key = dkey(targetRow.id, col.atLayer, col.key);
          if (val === originalValue(targetRow, col.atLayer, col.key)) next.delete(key);
          else next.set(key, val);
          count++;
        });
      });
      return next;
    });
    toast.success(`Pasted ${lines.length} row(s) · ${count} cells`);
  }

  const cellHandlers = (rowIndex: number, row: GridRow, field: string, kind: "text" | "select") => ({
    ref: (el: HTMLInputElement | HTMLSelectElement | null) => registerCell(rowIndex, field, el),
    onFocus: () => {
      activeRowIdRef.current = row.id;
    },
    onKeyDown: (e: React.KeyboardEvent) => onCellKeyDown(e, rowIndex, field),
    ...(kind === "text" ? { onPaste: (e: React.ClipboardEvent) => onCellPaste(e, rowIndex, field) } : {}),
  });

  /** Write one field on one row into the pending-changes map. */

  /** The same value across every row the bulk actions target. */
  function applyToTargets(l: EditLayer, field: string, value: string) {
    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of targetRows) {
        const key = dkey(row.id, l, field);
        if (value === originalValue(row, l, field)) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
    toast.success(
      `Applied to ${targetRows.length} rows` +
        (l === "BASE" ? "" : ` as ${l} overrides`)
    );
  }

  function openPanel(row: GridRow, field: string) {
    const col = COLUMNS.find((c) => c.key === field);
    setPanel({
      rowId: row.id,
      rowLabel: `${row.styleName} · ${row.name}`,
      field,
      fieldLabel: col?.label ?? field,
      layer,
      value: cellValue(row, layer, field),
      inherited: layer === "BASE" ? undefined : originalValue(row, "BASE", field),
    });
  }

  /**
   * Add one tag to every selected row without touching the tags already there.
   *
   * Fill-down replaces the whole comma-separated list, which is right for
   * correcting a value and wrong for "give these twelve products the SS27 tag" —
   * that wiped everything else off them. Additive, dirty-aware, and it says how
   * many rows actually changed rather than claiming all of them did.
   */
  function addTagToSelected(raw: string) {
    const tag = raw.trim();
    if (!tag || !targetRows.length) return;
    let added = 0;
    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of targetRows) {
        const key = dkey(row.id, layer, "tags");
        const current = (next.get(key) ?? originalValue(row, layer, "tags"))
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
        const value = [...current, tag].join(", ");
        if (value === originalValue(row, layer, "tags")) next.delete(key);
        else next.set(key, value);
        added++;
      }
      return next;
    });
    if (added)
      toast.success(`Added "${tag}" to ${added} row(s) — still needs Save`);
    else toast.info(`Every selected row already has "${tag}"`);
  }

  /**
   * Land a source product's fields on every targeted row as pending edits.
   *
   * Split fields are written at the layer being edited; the rest are
   * base-level, so a copy in the Shopify view creates Shopify overrides for the
   * text and touches base for type and references — the same rule the grid
   * already follows everywhere else.
   */
  function copyFieldsToTargets(
    values: Partial<Record<CopyableField, string>>,
    tagsMode: "replace" | "add"
  ) {
    if (!targetRows.length) return;
    const entries = Object.entries(values) as [CopyableField, string][];
    if (!entries.length) return;

    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of targetRows) {
        for (const [field, incoming] of entries) {
          const split = COLUMNS.find((c) => c.key === field)?.split ?? false;
          const l: EditLayer = split ? layer : "BASE";
          const key = dkey(row.id, l, field);

          let value = incoming;
          if (field === "tags" && tagsMode === "add") {
            const current = (next.get(key) ?? originalValue(row, l, "tags"))
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            const lower = new Set(current.map((t) => t.toLowerCase()));
            const added = incoming
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t && !lower.has(t.toLowerCase()));
            value = [...current, ...added].join(", ");
          }

          if (value === originalValue(row, l, field)) next.delete(key);
          else next.set(key, value);
        }
      }
      return next;
    });
    toast.success(
      `Copied ${entries.length} field(s) to ${targetRows.length} row(s) — still needs Save`
    );
  }

  /**
   * Copy chosen fields from one row to the rest of the selection.
   *
   * The source is the row you last put the cursor in, falling back to the first
   * selected row — and the picker names it either way, so it is never a guess
   * about which product you are copying from.
   */
  function copyDown(fieldKeys: string[]) {
    if (fieldKeys.length === 0 || targetRows.length < 2) return;
    const source =
      targetRows.find((r) => r.id === activeRowIdRef.current) ?? targetRows[0];
    const others = targetRows.filter((r) => r.id !== source.id);
    if (!others.length) return;

    const chosen = copyDownFields.filter((f) => fieldKeys.includes(f.key));
    // Always asked: the grid autosaves, so there is no Save step left to catch
    // a copy across the wrong rows.
    if (
      !confirm(
        `Overwrite ${chosen.map((f) => f.label).join(", ")} on ${others.length} ` +
          `product${others.length === 1 ? "" : "s"} with the value${chosen.length === 1 ? "" : "s"} ` +
          `from ${source.styleName} · ${source.name}?`
      )
    )
      return;
    setDirty((prev) => {
      const next = new Map(prev);
      for (const f of chosen) {
        const value = cellValue(source, f.atLayer, f.key);
        for (const row of others) {
          const key = dkey(row.id, f.atLayer, f.key);
          if (value === originalValue(row, f.atLayer, f.key)) next.delete(key);
          else next.set(key, value);
        }
      }
      return next;
    });
    toast.success(
      `Copied ${chosen.length} field(s) from ${source.styleName} · ${source.name} ` +
        `to ${others.length} row(s)`
    );
  }

  /**
   * Empty chosen fields across the selection.
   *
   * On a channel layer this removes the override rather than blanking the
   * value, so the row falls back to its base text — which is what "clear" means
   * when you are editing overrides.
   */
  function clearFields(fieldKeys: string[]) {
    if (fieldKeys.length === 0 || !targetRows.length) return;
    const chosen = copyDownFields.filter((f) => fieldKeys.includes(f.key));
    if (
      targetRows.length >= 25 &&
      !confirm(
        `Clear ${chosen.length} field(s) on ${targetRows.length} products?`
      )
    )
      return;
    setDirty((prev) => {
      const next = new Map(prev);
      for (const f of chosen) {
        // Multi-value references are JSON arrays; empty is "[]", not "".
        const empty = REF_MULTI.some((r) => r.key === f.key) ? "[]" : "";
        for (const row of targetRows) {
          const key = dkey(row.id, f.atLayer, f.key);
          if (empty === originalValue(row, f.atLayer, f.key)) next.delete(key);
          else next.set(key, empty);
        }
      }
      return next;
    });
    toast.success(
      `Cleared ${chosen.length} field(s) on ${targetRows.length} row(s)` +
        (layer === "BASE" ? "" : ` (${layer} overrides removed)`)
    );
  }

  /** The row copy-down would take its values from, for the picker to name. */
  const copySource =
    targetRows.find((r) => r.id === activeRowIdRef.current) ?? targetRows[0] ?? null;

  // ---- bulk reference apply (over visible rows) ----
  function applySingleRef(field: string, value: string) {
    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of targetRows) {
        const key = dkey(row.id, "BASE", field);
        if (value === originalValue(row, "BASE", field)) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
    toast.success(`Applied to ${targetRows.length} rows`);
  }

  function applyMultiRef(field: string, ids: string[], mode: "add" | "replace") {
    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of targetRows) {
        const key = dkey(row.id, "BASE", field);
        const cur = next.get(key) ?? originalValue(row, "BASE", field);
        let arr: string[] = [];
        try {
          arr = JSON.parse(cur || "[]");
        } catch {
          arr = [];
        }
        const merged =
          mode === "replace" ? ids : Array.from(new Set([...arr, ...ids]));
        const val = JSON.stringify(merged);
        if (val === originalValue(row, "BASE", field)) next.delete(key);
        else next.set(key, val);
      }
      return next;
    });
    toast.success(`${mode === "add" ? "Added to" : "Replaced on"} ${targetRows.length} rows`);
  }

  // ---- save ----
  const save = useCallback(
    async (opts: { auto?: boolean } = {}) => {
      // One save at a time. `saving` is state and lags, so the guard is a ref.
      if (savingRef.current) return;
      // Snapshot what we are sending. Anything typed while the request is in
      // flight must survive it — the old code cleared the whole map on success,
      // which silently threw away those keystrokes. Harmless at one save per
      // click; not harmless when a save fires every couple of seconds.
      const batch = new Map(dirtyRef.current);
      if (batch.size === 0) return;

      savingRef.current = true;
      setSaving(true);
      const changes: BulkChange[] = [];
      for (const [key, value] of batch) {
        const [id, l, field] = key.split("|") as [string, EditLayer, string];
        // The row's own season wins over the page's. An external is in exactly
        // one season and the external page pins none, so without this a price
        // typed there would have nowhere to be written; a Livid product in three
        // seasons has no "own" season and falls back to the tab, which is the
        // question those tabs exist to answer.
        const priceSeason =
          rowsRef.current.find((r) => r.id === id)?.priceSeasonId ?? seasonId;
        changes.push({
          colorwayId: id,
          field,
          layer: l,
          value,
          ...(field === "priceNok" && priceSeason ? { seasonId: priceSeason } : {}),
        });
      }
      try {
        const res = await fetch("/api/catalog/colorways/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
        setRows((prev) => applyChanges(prev, changes));
        // Retire only the keys we actually sent, and only where the value has
        // not moved on since.
        setDirty((prev) => {
          const next = new Map(prev);
          for (const [key, sent] of batch) {
            if (next.get(key) === sent) next.delete(key);
          }
          return next;
        });
        setSaveError(null);
        setSavedAt(new Date());
        // Autosave says so in the toolbar; a toast every few seconds is noise.
        if (!opts.auto)
          toast.success(
            `Saved ${data.changes} changes across ${data.colorways} colorways`
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Save failed";
        setSaveError(message);
        // Keep the edits. An autosave that fails quietly is worse than none:
        // say so once here, and the toolbar keeps saying it until it works.
        toast.error(opts.auto ? `Autosave failed — ${message}` : message);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [seasonId]
  );

  /**
   * Autosave.
   *
   * Only in the catalog editor, and only ever to the master: this grid writes
   * through /api/catalog/colorways/bulk and nothing here reaches Shopify or Loom
   * until somebody presses a push button. So saving early costs nothing and
   * losing an afternoon of typing costs a lot.
   *
   * Debounced rather than per-keystroke — the inline cells write to the pending
   * map on every character, and a request per character would be absurd.
   */
  useEffect(() => {
    if (!autosave || dirty.size === 0) return;
    const t = setTimeout(() => void save({ auto: true }), AUTOSAVE_IDLE_MS);
    return () => clearTimeout(t);
  }, [dirty, autosave, save]);

  // ---- Refresh from Shopify ----
  //
  // The master is thinner than the shop for everything that predates it: 2,288
  // products are ACTIVE in Shopify and DRAFT here because the column was never
  // populated, and 825 hold descriptions, care pages and fit guides in Shopify
  // that Origio has never seen.
  //
  // Reads, never corrects: a field is filled only where the master is empty, and
  // a MANUAL-owned field is left alone even then. Shopify is the fallback for
  // what nobody has typed here, not an authority over what somebody has.
  const [refreshBusy, setRefreshBusy] = useState(false);
  /**
   * A new Shopify link changes the Channels column, which is derived
   * server-side. The field merge below cannot produce it, and silently showing
   * the old badges is the staleness this whole handler exists to remove — so say
   * so instead of pretending.
   */
  const [needsReload, setNeedsReload] = useState(false);

  async function refreshFromShopify() {
    // The selection if there is one, else what the filters have narrowed to —
    // the same rule the bulk bar uses, so "these rows" means one thing.
    const target =
      selected.size > 0 ? visibleRows.filter((r) => selected.has(r.id)) : visibleRows;
    const ids = target.map((r) => r.id);
    if (!ids.length) return;

    // Rows with no Shopify link are the reason a refresh can silently do
    // nothing: the sync matches on the product GID the master recorded, and
    // 2,695 colorways have never had one. EXT-NRD-2CINM sat as DRAFT here while
    // Shopify held it ARCHIVED, and every refresh passed over it in silence.
    //
    // Finding them means sweeping the whole Shopify catalogue to match on
    // variant SKU, which is far heavier than reading back the ones already
    // linked — so it is asked for rather than assumed, and only when some of
    // these rows actually need it.
    const unlinked = target.filter((r) => !r.channelsLive.includes("SHOPIFY")).length;
    let withLink = false;
    if (unlinked > 0) {
      withLink = confirm(
        `${unlinked} of these ${unlinked === 1 ? "is" : "are"} not linked to a Shopify product, ` +
          `so a refresh cannot see ${unlinked === 1 ? "it" : "them"}.\n\n` +
          `Search Shopify for ${unlinked === 1 ? "it" : "them"} by SKU first? ` +
          `This reads the whole Shopify catalogue and takes a moment.\n\n` +
          `Cancel to refresh only the ${target.length - unlinked} already linked.`
      );
    }
    const parts = withLink ? ["link", "status", "fields"] : ["status", "fields"];
    setRefreshBusy(true);
    try {
      const dry = await fetch("/api/catalog/sync/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids, parts }),
      });
      const plan = await dry.json();
      if (!dry.ok) throw new Error(plan.error ?? "Could not read Shopify");

      const statusLines = Object.entries(plan.status?.byTransition ?? {}).map(
        ([k, v]) => `  ${v} × ${k}`
      );
      const fieldLines = Object.entries(plan.fields?.byField ?? {})
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 8)
        .map(([k, v]) => `  ${v} × ${k}`);

      if (!plan.status?.wouldChange && !plan.fields?.wouldFill && !plan.link?.wouldLink) {
        toast.success(`Already up to date — ${ids.length} checked.`);
        return;
      }
      if (
        !confirm(
          `Read ${ids.length} product(s) back from Shopify?\n\n` +
            (plan.link?.wouldLink
              ? `Link ${plan.link.wouldLink} to a Shopify product found by SKU` +
                (plan.link.ambiguous
                  ? ` (${plan.link.ambiguous} ambiguous SKUs left alone)`
                  : "") +
                `.\n\n`
              : "") +
            (plan.status?.wouldChange
              ? `Status (${plan.status.wouldChange}):\n${statusLines.join("\n")}\n\n`
              : "") +
            (plan.fields?.wouldFill
              ? `Fill blanks on ${plan.fields.wouldFill} product(s):\n${fieldLines.join("\n")}\n\n`
              : "") +
            `Only empty fields are filled. Nothing you have typed is overwritten.`
        )
      )
        return;

      const res = await fetch("/api/catalog/sync/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids, parts, apply: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Refresh failed");

      // Merge what landed into the rows on screen.
      //
      // `router.refresh()` cannot do this: the server re-renders and hands down
      // fresh `initialRows`, but those seed a `useState` that by design ignores
      // every later prop — so the page looked unchanged until a full reload.
      // The writes come back from the route instead and go through
      // `applyChanges`, the same merge a save uses, so there is one place that
      // knows how a field value becomes a cell.
      const merged: BulkChange[] = [];
      for (const a of (d.status?.applied ?? []) as { colorwayId: string; status: string }[])
        merged.push({
          colorwayId: a.colorwayId,
          field: "status",
          layer: "BASE",
          value: a.status,
        });
      for (const a of (d.fields?.applied ?? []) as {
        colorwayId: string;
        data: Record<string, unknown>;
      }[])
        for (const [field, value] of Object.entries(a.data))
          merged.push({
            colorwayId: a.colorwayId,
            field,
            layer: "BASE",
            // The reference lists are arrays here and JSON strings in the grid's
            // change format, which is what applyChanges parses back.
            value: Array.isArray(value) ? JSON.stringify(value) : String(value ?? ""),
          });
      if (merged.length) setRows((prev) => applyChanges(prev, merged));

      const statusN = d.status?.applied?.length ?? 0;
      const fieldsN = d.fields?.applied?.length ?? 0;
      const linkedN = d.link?.linked ?? 0;
      toast.success(
        [
          linkedN ? `${linkedN} linked` : "",
          statusN ? `${statusN} status` : "",
          fieldsN ? `${fieldsN} filled` : "",
        ]
          .filter(Boolean)
          .join(", ") || "Already up to date."
      );
      // A new link changes the Channels column, which is built server-side —
      // the merge above covers field values, not channel membership.
      if (linkedN) setNeedsReload(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshBusy(false);
    }
  }

  // ---- Push to wherever the product already lives ----
  //
  // No channel to choose. A product on Shopify, Sitoo and Loom — four of the five
  // Tarvas shoes are — has ONE price, and asking which channel to send it to is
  // asking someone to do the fan-out by hand and remember the third.
  //
  // It never creates: the targets are what each product is already on, so putting
  // something on Shopify for the first time stays a deliberate act in Publishing,
  // where the readiness gate and the payload preview are.
  const [pushBusy, setPushBusy] = useState(false);

  async function pushSelected() {
    const ids = [...selected].filter(
      (id) => rowsRef.current.find((r) => r.id === id)?.channels.length
    );
    if (!ids.length) {
      toast.error("None of the selected products are on a channel yet.");
      return;
    }
    if (dirty.size > 0) {
      toast.error("Save first — the channels would get the values before your edits.");
      return;
    }
    setPushBusy(true);
    try {
      const dry = await fetch("/api/catalog/push/fanout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids, dryRun: true }),
      });
      const plan = await dry.json();
      if (!dry.ok) throw new Error(plan.error ?? "Dry run failed");

      // Per product, what Shopify would actually receive: an update sends only
      // what changed in Origo since the last push.
      const shopifyChanges = (plan.shopifyChanges ?? []) as Array<{
        colorwaySku: string;
        send: string[];
        notSent: string[];
        note?: string;
      }>;
      const shopifyLines = shopifyChanges.slice(0, 8).map(
        (c) =>
          `  ${c.colorwaySku}: ` +
          (c.note ? c.note : c.send.length ? c.send.join(", ") : "nothing changed") +
          (c.notSent.length ? ` — not sent: ${c.notSent.join("; ")}` : "")
      );
      if (shopifyChanges.length > 8) shopifyLines.push(`  …and ${shopifyChanges.length - 8} more`);
      const lines = [
        plan.shopify
          ? `Shopify: ${plan.shopify}` + (shopifyLines.length ? `\n${shopifyLines.join("\n")}` : "")
          : null,
        plan.sitoo ? `Sitoo: ${plan.sitoo} (${plan.sitooChanges} differ)` : null,
        plan.loom ? `Loom: ${plan.loom}` : null,
      ].filter(Boolean);
      if (!lines.length) {
        toast.error("None of these are on a channel yet.");
        return;
      }
      if (
        !confirm(
          `Push ${plan.products} product(s) to the channels they are on?\n\n` +
            lines.join("\n") +
            (plan.noChannel?.length
              ? `\n\n${plan.noChannel.length} on no channel — skipped.`
              : "") +
            (plan.noSeason?.length
              ? `\n${plan.noSeason.length} in no season, so no price would be sent.`
              : "") +
            // The one way this push can report success and leave a product
            // wrong: Sitoo sells sizes the master has never held, and a family
            // write has to pass those rows back untouched.
            (plan.untouchedSizes?.length
              ? `\n\n⚠ ${plan.untouchedSizes.length} product(s) have sizes in Sitoo that Origio does not hold. ` +
                `Those sizes keep their current price:\n` +
                (plan.untouchedSizes as UntouchedSizes[])
                  .slice(0, 6)
                  .map((u) => `  ${u.colorwaySku}: ${u.inMaster} of ${u.inSitoo} sizes`)
                  .join("\n") +
                (plan.untouchedSizes.length > 6
                  ? `\n  …and ${plan.untouchedSizes.length - 6} more`
                  : "")
              : "")
        )
      )
        return;

      const res = await fetch("/api/catalog/push/fanout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Push failed");

      const reports = (d.reports ?? []) as ChannelPushReport[];
      const summary = reports
        .map((r) => `${r.channel} ${r.ok}/${r.attempted}${r.detail ? ` (${r.detail})` : ""}`)
        .join(" · ");
      const issues = reports.flatMap((r) => r.issues);
      if (issues.length)
        toast.warning(`${summary} — ${issues.length} issue(s): ${issues[0]}`, {
          duration: 12000,
        });
      else toast.success(`Pushed — ${summary}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushBusy(false);
    }
  }


  return (
    <div className="flex h-full flex-col px-8 py-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-page uppercase">
          {title ?? "Products"}
        </h1>
        {seasonal && (
        <div className="flex gap-1.5">
          <a
            href="/catalog/edit"
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-meta uppercase no-underline transition-colors duration-150 ease-origo",
              !season
                ? "border-ink bg-ink text-offwhite"
                : "border-line bg-paper text-ink hover:border-ink"
            )}
          >
            All
          </a>
          {seasons.map((s) => (
            <a
              key={s.code}
              href={`/catalog/edit?season=${s.code}`}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-meta uppercase no-underline transition-colors duration-150 ease-origo",
                season === s.code
                  ? "border-ink bg-ink text-offwhite"
                  : "border-line bg-paper text-ink hover:border-ink"
              )}
            >
              {s.code}
            </a>
          ))}
        </div>
        )}
        {/* Two column sets, not four.
            This row used to read BASE · Shopify (B2C) · Loom (B2B) · References,
            where the middle two switched every column to that channel's
            ChannelContent override. The whole database holds ONE such override —
            a Loom short-description on a single Livid shirt — so three quarters
            of the most prominent control on the screen served one row, while the
            question that actually organises the work, which system holds this
            product, had no place at all.
            It has one now: the Channel filter narrows the rows, and the Channels
            column says where each one lives. Overrides are still editable per
            product, on the colorway page, which is the right scale for a feature
            used once. */}
        <div className="flex gap-1.5">
          {(["BASE", "REFERENCES"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-full border px-3 py-1 text-fine transition-colors",
                view === v
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {v === "BASE" ? "Fields" : "References"}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by style, colorway, SKU…"
          className="h-8 w-64"
        />
        <ColumnPicker
          groups={[
            {
              title: "Product",
              columns: [
                { key: "__label", label: "Style · Colorway" },
                ...FIXED_COLS.map((c) => ({ key: c.key, label: c.label })),
              ],
            },
            isRefs
              ? {
                  title: "References",
                  columns: [...REF_SINGLE, ...REF_MULTI].map((c) => ({ key: c.key as string, label: c.label })),
                }
              : {
                  title: isBase ? "Fields" : `Fields with a ${layer} override`,
                  columns: columns.map((c) => ({ key: c.key, label: c.label })),
                },
          ]}
          hidden={hiddenCols}
          onChange={updateHiddenCols}
          frozen={frozenCols}
          onToggleFrozen={toggleFrozen}
        />
        <div className="flex gap-1" title="Filter by Threadflow dropped status">
          {(["all", "active", "dropped"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDroppedFilter(f)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-fine capitalize transition-colors",
                droppedFilter === f
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {f === "dropped" ? `Dropped (${droppedCount})` : f}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="text-fine text-muted-foreground underline underline-offset-4"
            >
              Clear {selected.size} selected
            </button>
          )}
          <span className="text-fine text-muted-foreground tabular-nums">
            {selected.size > 0 && `${selected.size} selected · `}
            {visibleRows.length} rows · {dirty.size} unsaved
          </span>
          <label
            className="flex items-center gap-1.5 text-fine text-muted-foreground"
            title="Saves to the master a moment after you stop typing. Nothing here reaches Shopify or Loom until you push."
          >
            <input
              type="checkbox"
              checked={autosave}
              onChange={(e) => setAutosave(e.target.checked)}
            />
            Autosave
          </label>
          <SaveStatus
            saving={saving}
            pending={dirty.size}
            savedAt={savedAt}
            error={saveError}
            autosave={autosave}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refreshFromShopify()}
            disabled={refreshBusy}
            title="Read status and merchandising fields back from Shopify for these rows. Fills blanks only."
          >
            {refreshBusy ? "Reading…" : "Refresh from Shopify"}
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || dirty.size === 0}
          >
            {saving ? "Saving…" : `Save ${dirty.size || ""}`.trim()}
          </Button>
        </div>
      </div>

      {/* Attribute filter bar (universal across views) */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FilterSelect label="Vendor" value={filters.vendor} options={filterOptions.vendor}
          onChange={(v) => setFilters((f) => ({ ...f, vendor: v }))} />
        <FilterSelect label="Type" value={filters.productType} options={filterOptions.productType}
          onChange={(v) => setFilters((f) => ({ ...f, productType: v }))} />
        <FilterSelect label="Gender" value={filters.gender} options={filterOptions.gender}
          onChange={(v) => setFilters((f) => ({ ...f, gender: v }))} />
        <FilterSelect label="Status" value={filters.status} options={[...PRODUCT_STATUSES]}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))} />
        <FilterSelect label="Source" value={filters.source} options={filterOptions.source}
          onChange={(v) => setFilters((f) => ({ ...f, source: v }))} />
        {/* Which system holds the product. The one filter that separates store
            vintage from online vintage: both are Vendor = Vintage, and only the
            channel tells them apart. */}
        <FilterSelect
          label="Channel"
          value={filters.channel}
          options={[
            ...PUBLISH_CHANNELS.map((c) => ({
              value: c,
              label: `On ${PUBLISH_CHANNEL_LABELS[c]}`,
            })),
            { value: "__none", label: "On no channel" },
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, channel: v }))}
        />
        {seasonal && season && (
          <>
            <FilterSelect
              label="Drop"
              value={filters.drop}
              options={[
                { value: "__none", label: "No drop yet" },
                ...filterOptions.drop.map((d) => ({ value: d, label: d })),
              ]}
              onChange={(v) => setFilters((f) => ({ ...f, drop: v }))}
            />
            <FilterSelect
              label="Origin"
              value={filters.origin}
              options={[
                { value: "NEW", label: "New this season" },
                { value: "CARRYOVER", label: "Carry-over" },
              ]}
              onChange={(v) => setFilters((f) => ({ ...f, origin: v }))}
            />
          </>
        )}
        <FilterSelect
          label="Needs"
          value={filters.needs}
          options={[
            { value: "noPrice", label: "No price" },
            { value: "noMedia", label: "No media" },
            { value: "noShortDesc", label: "No short desc" },
            { value: "noFullDesc", label: "No full desc" },
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, needs: v }))}
        />
        {Object.values(filters).some(Boolean) && (
          <button
            onClick={() =>
              setFilters({ vendor: "", productType: "", gender: "", status: "", source: "", needs: "", drop: "", origin: "", channel: "" })
            }
            className="text-fine text-muted-foreground underline underline-offset-4"
          >
            Clear filters
          </button>
        )}
      </div>

      {!seasonId && seasonal && (
        <p className="mt-2 border border-line bg-paper px-3 py-2 text-meta normal-case tracking-normal text-muted-foreground">
          Prices are per-season — select a season above to edit NOK prices.
        </p>
      )}
      {note && (
        <p className="mt-2 border border-line bg-paper px-3 py-2 text-meta normal-case tracking-normal text-muted-foreground">
          {note}
        </p>
      )}
      {needsReload && (
        <p className="mt-2 border border-ink bg-paper px-3 py-2 text-meta normal-case tracking-normal">
          Products were linked to Shopify. Reload to see their Channels column
          and refresh them for status and content.{" "}
          <button
            onClick={() => window.location.reload()}
            className="underline underline-offset-4"
          >
            Reload now
          </button>
        </p>
      )}
      {/* The one thing a green row does not say: a save reaches the master and
          nothing else. On the external page there is now a button for it, so the
          line points at the button; on the seasonal editor there is none, and it
          has to say so rather than let the till drift silently. */}
      {sitooRowsVisible > 0 && (
        <p className="mt-2 border border-line bg-paper px-3 py-2 text-meta normal-case tracking-normal text-muted-foreground">
          {sitooRowsVisible} of these are in Sitoo (POS).{" "}
          {seasonal
            ? "A name or price changed here does not reach the till — update them on the External products page."
            : "Saving writes the master only; select rows and push to send changes to every channel they are on."}
        </p>
      )}
      <p className="mt-2 text-fine text-muted-foreground">
        Tip: click a description, details or tagline cell to write it in a full
        panel — and apply it to a whole selection from there · <b>Enter</b> /{" "}
        <b>Shift+Enter</b> move down/up a column · paste a tab-separated block
        from a spreadsheet into any cell · select rows to copy fields between
        them.
      </p>
      {selected.size > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-meta normal-case tracking-normal text-muted-foreground">
            {selected.size} selected — copy down and bulk actions apply to
            these rows. Shift-click a checkbox to select a range.
          </p>
          <AddTagToSelected count={selected.size} onAdd={addTagToSelected} />
          {!seasonal && pushableSelected > 0 && (
            <Button size="sm" onClick={() => void pushSelected()} disabled={pushBusy}>
              {pushBusy ? "Pushing…" : `Push ${pushableSelected} to their channels`}
            </Button>
          )}
          <FieldBulkPicker
            fields={copyDownFields}
            source={copySource}
            selectedCount={targetRows.length}
            layer={layer}
            onCopy={copyDown}
            onClear={clearFields}
          />
          <button
            onClick={() => setCopyOpen(true)}
            className="h-7 border px-2 text-fine hover:bg-muted"
            title="Take the description and other fields off a product that is already written"
          >
            Copy fields from a product…
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-fine text-muted-foreground underline underline-offset-4"
          >
            Clear selection
          </button>
        </div>
      )}
      {isRefs && (
        <div className="mt-2 space-y-2">
          <p className="text-fine text-muted-foreground">
            References. Edit inline, or use the bulk bar. Bulk
            actions apply to {selected.size > 0 ? `the ${selected.size} selected` : `all ${visibleRows.length} filtered`} rows.
          </p>
          <BulkRefApply
            refOptions={refOptions}
            colorwayOptions={colorwayOptions}
            targetCount={targetRows.length}
            scope={selected.size > 0 ? "selected" : "filtered"}
            onApplySingle={applySingleRef}
            onApplyMulti={applyMultiRef}
          />
        </div>
      )}

      {/* Grid */}
      <div
        ref={scrollRef}
        className="mt-3 flex-1 overflow-auto border"
      >
        <div style={{ width: totalWidth, position: "relative" }}>
          {/* Header */}
          <div
            className={cn(gridHead, "flex")}
            style={{ width: totalWidth }}
          >
            <div
              style={place("__select", SELECT_W, false, true)}
              className="flex shrink-0 items-center justify-center"
            >
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                title="Select all filtered rows"
              />
            </div>
            {shown("__label") ? (
              <div
                style={place("__label", LABEL_W, false, true)}
                className="flex shrink-0 items-center justify-between gap-1 border-l px-3 py-2"
              >
                <span className="truncate">Style · Colorway</span>
                <span className="flex shrink-0 items-center">
                  {pinButton("__label")}
                  {sortButton("__label")}
                </span>
              </div>
            ) : null}
            {shownFixed.map((c) => (
              <div
                key={c.key}
                style={place(c.key, c.width, false, true)}
                className="flex shrink-0 items-center justify-between gap-1 border-l px-2 py-2"
              >
                <span className="truncate">{c.label}</span>
                <span className="flex shrink-0 items-center">
                  {pinButton(c.key)}
                  {SORTABLE_FIXED.has(c.key) ? sortButton(c.key) : null}
                </span>
              </div>
            ))}
            {/* The "↓" here SORTS. It used to fill the column down every visible
                row — it read as a sort, and one click autosaved one product's
                details onto 17 others. Copying across rows lives in the
                selection bar, where it names its source and asks first. */}
            {(isRefs ? [...shownRefSingle, ...shownRefMulti] : shownColumns).map((c) => (
              <div
                key={c.key}
                style={place(c.key as string, c.width, false, true)}
                className="flex shrink-0 items-center justify-between gap-1 border-l px-2 py-2"
                title={COLUMN_HINTS[c.key as string]}
              >
                <span className="truncate">{c.label}</span>
                <span className="flex shrink-0 items-center">
                  {pinButton(c.key as string)}
                  {sortButton(c.key as string)}
                </span>
              </div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = visibleRows[vi.index];
              const isSel = selected.has(row.id);
              return (
                <div
                  key={row.id}
                  className={cn(
                    gridRow,
                    "absolute left-0 flex",
                    isSel && gridRowSelected
                  )}
                  style={{
                    top: vi.start,
                    height: ROW_H,
                    width: totalWidth,
                  }}
                >
                  <div
                    style={place("__select", SELECT_W, isSel)}
                    className="flex shrink-0 items-center justify-center"
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => {}}
                      onClick={(e) => toggleRow(vi.index, e.shiftKey)}
                      title="Select (shift-click for range)"
                    />
                  </div>
                  {/* The product block — frozen by default, hideable like the rest */}
                  {shown("__label") ? (
                  <div
                    style={place("__label", LABEL_W, isSel)}
                    className="flex shrink-0 items-center gap-2 border-l px-3"
                  >
                    <div className="h-6 w-6 shrink-0 overflow-hidden bg-muted">
                      {catalogImageSrc(row.thumbnailRef) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={catalogImageSrc(row.thumbnailRef)!}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 leading-tight">
                      <a
                        href={`/catalog/colorways/${row.id}`}
                        className="block truncate text-fine hover:underline"
                      >
                        {row.dropped && (
                          <span
                            title="Dropped from Threadflow for this season"
                            className="mr-1 border border-line px-1 text-fine uppercase text-muted-foreground"
                          >
                            Dropped
                          </span>
                        )}
                        {row.name}
                      </a>
                      <span className="block truncate text-fine text-muted-foreground">
                        {row.styleName}
                        {row.drop && <> · {row.drop}</>}
                        {row.origin === "CARRYOVER" && (
                          <span
                            title="Carried over from an earlier season"
                            className="ml-1 uppercase"
                          >
                            carry-over
                          </span>
                        )}

                      </span>
                    </div>
                  </div>
                  ) : null}

                  {/* Name, title, channels, swatch, price, media — each hideable */}
                  {shown("name") ? (
                  <div
                    style={place("name", FIXED_WIDTH["name"], isSel)}
                    className={cn(
                      "shrink-0 border-l",
                      dirty.has(dkey(row.id, "BASE", "name")) && dirtyCell
                    )}
                  >
                    <input
                      {...cellHandlers(vi.index, row, "name", "text")}
                      value={cellValue(row, "BASE", "name")}
                      onChange={(e) => setCell(row, "name", e.target.value, "BASE")}
                      title={
                        row.ownsStyle
                          ? "The product name. This product is its own style, so the style name moves with it."
                          : `One colour of "${row.styleName}" — the style keeps its name, and the title becomes "${row.styleName} <name>".`
                      }
                      className="h-full w-full bg-transparent px-2 text-fine outline-none focus:bg-background"
                    />
                  </div>
                  ) : null}
                  {/* Derived, never editable: what channelProductTitle will send. */}
                  {shown("title") ? (
                  <div
                    style={place("title", FIXED_WIDTH["title"], isSel)}
                    className="flex shrink-0 items-center border-l px-2 text-fine text-muted-foreground"
                    title="What Shopify and the till will show. Loom is sent the name on its own."
                  >
                    <span className="truncate">
                      {channelProductTitle({
                        name: cellValue(row, "BASE", "name"),
                        style: {
                          styleName: row.ownsStyle
                            ? cellValue(row, "BASE", "name")
                            : row.styleName,
                        },
                      })}
                    </span>
                  </div>
                  ) : null}
                  {shown("channels") ? (
                  <div
                    style={place("channels", FIXED_WIDTH["channels"], isSel)}
                    className="flex shrink-0 items-center gap-1 border-l px-2 text-fine"
                    title={
                      row.channels.length
                        ? [
                            row.channelsLive.length
                              ? `On ${row.channelsLive
                                  .map((c) => PUBLISH_CHANNEL_LABELS[c as PublishChannelKey] ?? c)
                                  .join(", ")}`
                              : null,
                            row.channels.some((c) => !row.channelsLive.includes(c))
                              ? `Targeted but not yet pushed: ${row.channels
                                  .filter((c) => !row.channelsLive.includes(c))
                                  .map((c) => PUBLISH_CHANNEL_LABELS[c as PublishChannelKey] ?? c)
                                  .join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "On no channel — nothing here reaches a customer"
                    }
                  >
                    {row.channels.length ? (
                      PUBLISH_CHANNELS.map((c) => {
                        // Three states, because "aimed at" and "actually there"
                        // are different facts and the push behaves differently
                        // for each: filled = the channel holds it (a push
                        // updates), outline = targeted but never pushed (a push
                        // creates), faint = not targeted at all.
                        const live = row.channelsLive.includes(c);
                        const targeted = row.channels.includes(c);
                        return (
                          <span
                            key={c}
                            aria-hidden
                            className={cn(
                              "inline-flex h-4 w-4 items-center justify-center border text-[10px] leading-none",
                              live
                                ? "border-ink bg-ink text-offwhite"
                                : targeted
                                  ? "border-ink text-ink"
                                  : "border-line text-subtle"
                            )}
                          >
                            {CHANNEL_INITIAL[c]}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                    <span className="sr-only">
                      {row.channels.length ? row.channels.join(", ") : "no channel"}
                    </span>
                  </div>
                  ) : null}
                  {shown("swatchHex") ? (
                  <div
                    style={place("swatchHex", FIXED_WIDTH["swatchHex"], isSel)}
                    className={cn(
                      "flex shrink-0 items-center gap-1 border-l px-1",
                      dirty.has(dkey(row.id, "BASE", "swatchHex")) && dirtyCell
                    )}
                  >
                    <span
                      className="h-4 w-4 shrink-0 border"
                      style={{ backgroundColor: cellValue(row, "BASE", "swatchHex") || "transparent" }}
                    />
                    <input
                      {...cellHandlers(vi.index, row, "swatchHex", "text")}
                      value={cellValue(row, "BASE", "swatchHex")}
                      placeholder="#hex"
                      onChange={(e) => setCell(row, "swatchHex", e.target.value, "BASE")}
                      className="w-full bg-transparent text-fine outline-none focus:bg-background"
                    />
                  </div>
                  ) : null}
                  {shown("priceNok") ? (
                  <div
                    style={place("priceNok", FIXED_WIDTH["priceNok"], isSel)}
                    className={cn(
                      "shrink-0 border-l",
                      dirty.has(dkey(row.id, "BASE", "priceNok")) && dirtyCell
                    )}
                  >
                    <input
                      {...cellHandlers(vi.index, row, "priceNok", "text")}
                      value={cellValue(row, "BASE", "priceNok")}
                      disabled={!(row.priceSeasonId ?? seasonId)}
                      placeholder={row.priceSeasonId ?? seasonId ? "NOK" : "season"}
                      onChange={(e) => setCell(row, "priceNok", e.target.value, "BASE")}
                      title={
                        row.priceSeasonId ?? seasonId
                          ? "NOK MSRP"
                          : "In several seasons — pick one above to edit the price"
                      }
                      className="h-full w-full bg-transparent px-2 text-fine tabular-nums outline-none focus:bg-background disabled:opacity-40"
                    />
                  </div>
                  ) : null}
                  {shown("media") ? (
                  <a
                    href={`/catalog/colorways/${row.id}/media`}
                    style={place("media", FIXED_WIDTH["media"], isSel)}
                    className="flex shrink-0 items-center justify-center gap-1 border-l text-fine text-muted-foreground hover:bg-muted hover:underline"
                    title="Manage media"
                  >
                    ▦ {row.mediaCount}
                  </a>
                  ) : null}

                  {/* Editable cells */}
                  {isRefs ? (
                    <>
                      {shownRefSingle.map((c) => {
                        const value = cellValue(row, "BASE", c.key);
                        const isDirty = dirty.has(dkey(row.id, "BASE", c.key));
                        return (
                          <div
                            key={c.key}
                            style={place(c.key as string, c.width, isSel)}
                            className={cn("shrink-0 border-l", isDirty && dirtyCell)}
                          >
                            <select
                              {...cellHandlers(vi.index, row, c.key, "select")}
                              value={value}
                              onChange={(e) => setCell(row, c.key, e.target.value, "BASE")}
                              className="h-full w-full bg-transparent px-1 text-fine outline-none"
                            >
                              <option value="">—</option>
                              {refOptions[c.src].map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                      {shownRefMulti.map((c) => {
                        const value = cellValue(row, "BASE", c.key as string);
                        const isDirty = dirty.has(dkey(row.id, "BASE", c.key as string));
                        let count = 0;
                        try {
                          count = (JSON.parse(value || "[]") as string[]).length;
                        } catch {
                          count = 0;
                        }
                        return (
                          <div
                            key={c.key}
                            style={place(c.key as string, c.width, isSel)}
                            className={cn(
                              "flex shrink-0 items-center justify-between gap-1 border-l px-2 text-fine",
                              isDirty && dirtyCell
                            )}
                          >
                            <span className={count ? "" : "text-muted-foreground/50"}>
                              {count} linked
                            </span>
                            {count > 0 && (
                              <button
                                onClick={() => setCell(row, c.key as string, "[]", "BASE")}
                                title="Clear"
                                className="text-muted-foreground hover:text-destructive"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    shownColumns.map((c) => {
                      const disabled = !isBase && !c.split;
                      const value = cellValue(row, layer, c.key);
                      const isDirty = dirty.has(dkey(row.id, layer, c.key));
                      const placeholder =
                        !isBase && c.split
                          ? originalValue(row, "BASE", c.key) || undefined
                          : undefined;
                      return (
                        <div
                          key={c.key}
                          style={place(c.key as string, c.width, isSel)}
                          className={cn(
                            "shrink-0 border-l",
                            isDirty && dirtyCell
                          )}
                        >
                          {c.kind === "status" ? (
                            <select
                              {...(disabled ? {} : cellHandlers(vi.index, row, c.key, "select"))}
                              value={value}
                              disabled={disabled}
                              onChange={(e) => setCell(row, c.key, e.target.value)}
                              className="h-full w-full bg-transparent px-2 text-fine outline-none disabled:opacity-40"
                            >
                              {PRODUCT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          ) : LONG_TEXT_FIELDS.has(c.key) ? (
                            // Read-only here; the writing happens in the panel.
                            <button
                              type="button"
                              disabled={disabled}
                              onFocus={() => {
                                activeRowIdRef.current = row.id;
                              }}
                              onClick={() => openPanel(row, c.key)}
                              // Making this cell read-only took away the
                              // obvious way to empty it — select the text and
                              // hit delete. Give that back on the key itself,
                              // so clearing one cell does not mean opening a
                              // panel to delete and apply.
                              onKeyDown={(e) => {
                                if (e.key === "Delete" || e.key === "Backspace") {
                                  e.preventDefault();
                                  if (value) setCell(row, c.key, "");
                                }
                              }}
                              title={
                                value
                                  ? `${toPlainText(value)}\n\nClick to edit · Delete to clear`
                                  : placeholder || "Click to write"
                              }
                              className={cn(
                                "h-full w-full truncate px-2 text-left text-meta normal-case tracking-normal hover:bg-hover focus:bg-paper focus:outline focus:outline-2 focus:outline-cyan disabled:opacity-40",
                                !value && "text-muted-foreground/50"
                              )}
                            >
                              {/* The stored value may be HTML — 2,643 of these
                                  carry markup from the Cin7 import. Shown as
                                  text so a cell reads as a description instead
                                  of a tag soup; the value itself is untouched,
                                  because publish.ts pushes it back to Shopify
                                  and the markup is what the storefront renders. */}
                              {toPlainText(value) || placeholder || "—"}
                            </button>
                          ) : (
                            <input
                              {...(disabled ? {} : cellHandlers(vi.index, row, c.key, "text"))}
                              value={disabled ? originalValue(row, "BASE", c.key) : value}
                              disabled={disabled}
                              placeholder={placeholder}
                              onChange={(e) => setCell(row, c.key, e.target.value)}
                              className="h-full w-full bg-transparent px-2 text-fine outline-none placeholder:text-muted-foreground/50 focus:bg-background disabled:opacity-40"
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <CopyFieldsDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        targetCount={targetRows.length}
        onCopy={copyFieldsToTargets}
      />

      {panel && (
        <CellPanel
          // Remount per cell so the textarea seeds from the new value without
          // an effect syncing state to props.
          key={`${panel.rowId}|${panel.layer}|${panel.field}`}
          target={panel}
          // The real selection, not targetRows — that falls back to every
          // filtered row, so with nothing selected the bulk button would have
          // offered to overwrite the whole season.
          selectedCount={selected.size}
          onClose={() => setPanel(null)}
          onApply={(value) => {
            const row = rows.find((r) => r.id === panel.rowId);
            if (row) setCell(row, panel.field, value, panel.layer);
          }}
          onApplyToSelected={(value) =>
            applyToTargets(panel.layer, panel.field, value)
          }
        />
      )}
    </div>
  );
}

const SINGLE_REF_KEYS = new Set(REF_SINGLE.map((c) => c.key));
const MULTI_REF_KEYS = new Set(REF_MULTI.map((c) => c.key as string));

/**
 * Pick fields, then copy them down from one selected row or clear them.
 *
 * The same shape as the legacy editor's Copy Down, with two changes: the source
 * is named rather than left as "the first selected product", and clearing lives
 * here too. Clearing is the same operation with an empty value, so it belongs
 * behind the same field picker rather than in a mechanism of its own.
 */
function FieldBulkPicker({
  fields,
  source,
  selectedCount,
  layer,
  onCopy,
  onClear,
}: {
  fields: { key: string; label: string }[];
  source: GridRow | null;
  selectedCount: number;
  layer: EditLayer;
  onCopy: (keys: string[]) => void;
  onClear: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const others = Math.max(selectedCount - 1, 0);

  const toggle = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const run = (fn: (keys: string[]) => void) => {
    fn([...chosen]);
    setChosen(new Set());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={selectedCount < 1}
          className="h-7 border px-2 text-fine hover:bg-muted disabled:opacity-40"
          title="Copy chosen fields from one selected row to the rest, or clear them"
        >
          Copy down / clear…
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-body">Which fields?</p>
          <p className="text-fine text-muted-foreground">
            {source ? (
              <>
                Copying takes them from <b>{source.styleName} · {source.name}</b>{" "}
                to the {others} other{others === 1 ? "" : "s"} — click a cell in
                a different row to copy from that one instead. Clearing empties
                them on all {selectedCount}.
              </>
            ) : (
              <>Select some rows first.</>
            )}
          </p>
        </div>
        <div className="max-h-[220px] space-y-0.5 overflow-auto p-2">
          {fields.map((f) => (
            <label
              key={f.key}
              className="flex cursor-pointer items-center gap-2 px-1 py-1 text-body hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={chosen.has(f.key)}
                onChange={() => toggle(f.key)}
              />
              {f.label}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <button
            onClick={() => setChosen(new Set(fields.map((f) => f.key)))}
            className="text-fine text-muted-foreground underline underline-offset-4"
          >
            Select all
          </button>
          <button
            onClick={() => run(onClear)}
            disabled={!chosen.size || selectedCount < 1}
            className="ml-auto border px-2 py-1 text-fine text-destructive hover:bg-destructive/10 disabled:opacity-40"
            title={
              layer === "BASE"
                ? "Empty these fields on every selected row"
                : `Remove these ${layer} overrides on every selected row`
            }
          >
            Clear ({chosen.size})
          </button>
          <Button
            size="sm"
            onClick={() => run(onCopy)}
            disabled={!chosen.size || !source || others < 1}
          >
            Copy ({chosen.size})
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Where the pending edits stand. With autosave on, the Save button is mostly
 * idle, so this is what tells you whether your work is safe.
 */
function SaveStatus({
  saving,
  pending,
  savedAt,
  error,
  autosave,
}: {
  saving: boolean;
  pending: number;
  savedAt: Date | null;
  error: string | null;
  autosave: boolean;
}) {
  if (error)
    return (
      <span className="text-fine text-destructive" title={error}>
        Not saved — {pending} pending
      </span>
    );
  if (saving) return <span className="text-fine text-muted-foreground">Saving…</span>;
  if (pending > 0)
    return (
      <span className="text-meta uppercase text-ink">
        {autosave ? "Saving shortly…" : `${pending} unsaved`}
      </span>
    );
  if (savedAt)
    return (
      <span className="text-fine text-muted-foreground">
        Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  return null;
}

/** Append a tag to the selection, leaving existing tags alone. */
function AddTagToSelected({
  count,
  onAdd,
}: {
  count: number;
  onAdd: (tag: string) => void;
}) {
  const [tag, setTag] = useState("");
  const submit = () => {
    if (!tag.trim()) return;
    onAdd(tag);
    setTag("");
  };
  return (
    <span className="flex items-center gap-1">
      <input
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Add a tag…"
        className="h-7 w-32 border bg-transparent px-2 text-fine"
      />
      <button
        onClick={submit}
        disabled={!tag.trim()}
        className="h-7 border px-2 text-fine hover:bg-muted disabled:opacity-40"
      >
        Add to {count}
      </button>
    </span>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange: (value: string) => void;
}) {
  const opts = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
      className={cn(
        "h-8 border bg-transparent px-2 text-fine",
        value ? "border-foreground" : "text-muted-foreground"
      )}
    >
      <option value="">{label}: all</option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {label}: {o.label}
        </option>
      ))}
    </select>
  );
}

type RefField =
  | { key: string; label: string; kind: "single"; src: "care" | "fitguide" | "collection" | "model" }
  | { key: string; label: string; kind: "multi" };

const REF_FIELDS: RefField[] = [
  ...REF_SINGLE.map((c) => ({ key: c.key, label: c.label, kind: "single" as const, src: c.src })),
  ...REF_MULTI.map((c) => ({ key: c.key as string, label: c.label, kind: "multi" as const })),
];

function BulkRefApply({
  refOptions,
  colorwayOptions,
  targetCount,
  scope,
  onApplySingle,
  onApplyMulti,
}: {
  refOptions: Record<"care" | "fitguide" | "collection" | "model", { id: string; label: string }[]>;
  colorwayOptions: { id: string; label: string }[];
  targetCount: number;
  scope: "selected" | "filtered";
  onApplySingle: (field: string, value: string) => void;
  onApplyMulti: (field: string, ids: string[], mode: "add" | "replace") => void;
}) {
  const [fieldKey, setFieldKey] = useState(REF_FIELDS[0].key);
  const field = REF_FIELDS.find((f) => f.key === fieldKey)!;
  const [q, setQ] = useState("");
  const [single, setSingle] = useState<{ id: string; label: string } | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"add" | "replace">("add");

  const options = field.kind === "single" ? refOptions[field.src] : colorwayOptions;
  const labelById = useMemo(
    () => new Map(options.map((o) => [o.id, o.label])),
    [options]
  );
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return options
      .filter((o) => o.label.toLowerCase().includes(query) && !ids.includes(o.id))
      .slice(0, 8);
  }, [q, options, ids]);

  function changeField(key: string) {
    setFieldKey(key);
    setQ("");
    setSingle(null);
    setIds([]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border bg-muted/30 p-2">
      <span className="px-1 text-fine">Bulk set</span>
      <select
        value={fieldKey}
        onChange={(e) => changeField(e.target.value)}
        className="h-8 border bg-transparent px-2 text-fine"
      >
        {REF_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>

      {/* value picker */}
      <div className="relative">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={field.kind === "single" ? "Search…" : "Search products…"}
          className="h-8 w-64"
        />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 w-64 overflow-hidden border border-line bg-paper shadow-overlay">
            {matches.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  if (field.kind === "single") {
                    setSingle(o);
                    setQ(o.label);
                  } else {
                    setIds((prev) => [...prev, o.id]);
                    setQ("");
                  }
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-fine hover:bg-muted"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {field.kind === "multi" && ids.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-fine">
              {labelById.get(id) ?? id}
              <button onClick={() => setIds((p) => p.filter((x) => x !== id))} className="text-muted-foreground hover:text-destructive">✕</button>
            </span>
          ))}
        </div>
      )}

      {field.kind === "multi" && (
        <div className="flex gap-1">
          {(["add", "replace"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-fine capitalize",
                mode === m ? "border-foreground bg-foreground text-background" : "text-muted-foreground"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <Button
        size="sm"
        disabled={field.kind === "single" ? !single : ids.length === 0}
        onClick={() => {
          if (field.kind === "single" && single) onApplySingle(field.key, single.id);
          else if (field.kind === "multi" && ids.length) onApplyMulti(field.key, ids, mode);
        }}
      >
        Apply to {targetCount} {scope}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() =>
          field.kind === "single"
            ? onApplySingle(field.key, "")
            : onApplyMulti(field.key, [], "replace")
        }
      >
        Clear on {targetCount} {scope}
      </Button>
    </div>
  );
}

// Apply saved changes to the in-memory rows so the grid reflects them.
function applyChanges(rows: GridRow[], changes: BulkChange[]): GridRow[] {
  const byId = new Map(
    rows.map((r) => [
      r.id,
      {
        ...r,
        base: { ...r.base },
        overrides: { SHOPIFY: { ...r.overrides.SHOPIFY }, LOOM: { ...r.overrides.LOOM } },
        refs: { ...r.refs },
      },
    ])
  );
  for (const ch of changes) {
    const row = byId.get(ch.colorwayId);
    if (!row) continue;
    const v = typeof ch.value === "string" ? ch.value : "";
    if (ch.field === "priceNok") {
      row.priceNok = v;
    } else if (SINGLE_REF_KEYS.has(ch.field)) {
      (row.refs as Record<string, unknown>)[ch.field] = v;
    } else if (MULTI_REF_KEYS.has(ch.field)) {
      let ids: string[] = [];
      try {
        ids = JSON.parse(v || "[]");
      } catch {
        ids = [];
      }
      (row.refs as Record<string, unknown>)[ch.field] = ids;
    } else if (ch.layer === "BASE") {
      // Name is a column on Colorway, not one of the enrichment text fields, so
      // it needs its own case — without it the value landed in `row.base.name`,
      // the dirty key was retired, and the Name and Title cells snapped back to
      // the old value while the database held the new one. A grid that shows
      // the wrong name after a successful save is worse than one that fails.
      if (ch.field === "name") {
        // A blank cell is skipped server-side (autosave fires mid-typing), so
        // skip it here too or the two drift apart.
        if (v.trim()) {
          row.name = v.trim();
          // The style moved with it server-side when this product is the whole
          // style; mirror that so the label and the composed title agree.
          if (row.ownsStyle) row.styleName = v.trim();
        }
      } else if (ch.field === "status") row.status = v;
      else if (ch.field === "tags")
        row.tags = v.split(",").map((t) => t.trim()).filter(Boolean);
      else if (ch.field === "vendor") row.vendor = v;
      else if (ch.field === "productType") row.productType = v;
      else if (ch.field === "swatchHex") row.swatchHex = v;
      else row.base[ch.field] = v;
    } else {
      if (v.trim()) row.overrides[ch.layer][ch.field] = v;
      else delete row.overrides[ch.layer][ch.field];
    }
  }
  return [...byId.values()];
}

/**
 * Choose which columns to work with, and which to freeze. Every column can be
 * hidden, the product block included; frozen ones stay on the left while the
 * rest scroll.
 */
function ColumnPicker({
  groups,
  hidden,
  onChange,
  frozen,
  onToggleFrozen,
}: {
  groups: { title: string; columns: { key: string; label: string }[] }[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  frozen: Set<string>;
  onToggleFrozen: (key: string) => void;
}) {
  const all = groups.flatMap((g) => g.columns);
  const hiddenHere = all.filter((c) => hidden.has(c.key)).length;

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  const setAll = (hide: boolean) => {
    const next = new Set(hidden);
    for (const c of all) {
      if (hide) next.add(c.key);
      else next.delete(c.key);
    }
    onChange(next);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="h-8 border px-3 text-fine hover:bg-muted">
          Columns{hiddenHere ? ` (${all.length - hiddenHere} of ${all.length})` : ""}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Columns</DialogTitle>
          <DialogDescription>
            Choose the columns to work with, and pin the ones that should stay on the left
            while you scroll. Hidden columns keep their values and are left out of keyboard
            movement and copy down. Remembered in this browser.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-auto">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-fine text-muted-foreground">{g.title}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {g.columns.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 text-body">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!hidden.has(c.key)}
                        onChange={() => toggle(c.key)}
                      />
                      <span className="truncate">{c.label}</span>
                    </label>
                    <button
                      type="button"
                      title={frozen.has(c.key) ? "Unfreeze" : "Freeze on the left"}
                      onClick={() => onToggleFrozen(c.key)}
                      className={frozen.has(c.key) ? "text-foreground" : "text-muted-foreground/40 hover:text-foreground"}
                    >
                      {frozen.has(c.key) ? <PinIcon className="size-3.5" /> : <PinOffIcon className="size-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-3">
            <button
              onClick={() => setAll(false)}
              className="text-fine underline underline-offset-4"
            >
              Show all
            </button>
            <button
              onClick={() => setAll(true)}
              className="text-fine text-muted-foreground underline underline-offset-4"
            >
              Hide all
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
