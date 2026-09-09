"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  CHANNELS,
  CHANNEL_LABELS,
  PRODUCT_STATUSES,
} from "@/lib/master/fields";
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
  { key: "status", label: "Status", width: 104, kind: "status", split: false },
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
  ...Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])),
  ...Object.fromEntries(REF_SINGLE.map((c) => [c.key, c.label])),
  ...Object.fromEntries(REF_MULTI.map((c) => [c.key, c.label])),
};

const SELECT_W = 36; // row-select checkbox column
const LABEL_W = 320; // frozen-ish left block (img + style + colorway)
const ROW_H = 40;

/** How long the grid waits after the last edit before autosaving. */
const AUTOSAVE_IDLE_MS = 1500;

function dkey(id: string, layer: EditLayer, field: string) {
  return `${id}|${layer}|${field}`;
}

// Always-visible columns (every layer), left of the layer-specific columns.
const FIXED_COLS: { key: string; label: string; width: number }[] = [
  { key: "swatchHex", label: "Swatch", width: 76 },
  { key: "priceNok", label: "NOK", width: 84 },
  { key: "media", label: "Media", width: 78 },
];
const FIXED_W = FIXED_COLS.reduce((s, c) => s + c.width, 0);

export function CatalogGrid({
  initialRows,
  seasons,
  season,
  seasonId,
  colorwayOptions,
}: {
  initialRows: GridRow[];
  seasons: { code: string }[];
  season?: string;
  seasonId?: string;
  colorwayOptions: { id: string; label: string }[];
}) {
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [view, setView] = useState<View>("BASE");
  const [dirty, setDirty] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
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
  });
  const [saving, setSaving] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  // The debounced save reads the pending map through a ref so it does not need
  // to be rebuilt (and reschedule itself) on every keystroke.
  const dirtyRef = useRef(dirty);
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
  const refWidth = isRefs
    ? [...REF_SINGLE, ...REF_MULTI].reduce((s, c) => s + c.width, 0)
    : 0;
  const totalWidth =
    SELECT_W +
    LABEL_W +
    FIXED_W +
    (isRefs ? refWidth : columns.reduce((sum, c) => sum + c.width, 0));

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

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
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
      if (filters.needs && !needsMatch(r)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.styleName.toLowerCase().includes(q) ||
        r.colorwaySku.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, droppedFilter, filters]);

  const droppedCount = rows.filter((r) => r.dropped).length;

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
      { key: "swatchHex", kind: "text" as const, atLayer: "BASE" as EditLayer },
      { key: "priceNok", kind: "text" as const, atLayer: "BASE" as EditLayer },
    ];
    if (isRefs)
      return [
        ...fixed,
        ...REF_SINGLE.map((c) => ({ key: c.key, kind: "select" as const, atLayer: "BASE" as EditLayer })),
      ];
    const cols = isBase ? COLUMNS : COLUMNS.filter((c) => c.split);
    return [
      ...fixed,
      ...cols.map((c) => ({
        key: c.key,
        kind: (c.kind === "status" ? "select" : "text") as "text" | "select",
        atLayer: layer,
      })),
    ];
  }, [isRefs, isBase, layer]);

  /**
   * What copy-down can offer in this view, each with the layer it writes to.
   * Derived from editableCols so it can never drift from what the grid will
   * actually accept, plus the multi-value references, which copy verbatim as
   * JSON. Price is omitted without a season — it is season-scoped and there
   * would be nowhere to put it.
   */
  const copyDownFields = useMemo(() => {
    const base = editableCols
      .filter((c) => !(c.key === "priceNok" && !seasonId))
      .map((c) => ({
        key: c.key,
        label: FIELD_LABELS[c.key] ?? c.key,
        atLayer: c.atLayer,
      }));
    if (!isRefs) return base;
    return [
      ...base,
      ...REF_MULTI.map((c) => ({
        key: c.key as string,
        label: c.label,
        atLayer: "BASE" as EditLayer,
      })),
    ];
  }, [editableCols, isRefs, seasonId]);

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
          if (col.key === "priceNok" && !seasonId) return;
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

  // ---- fill down: copy the focused (or top) row's value to target rows ----
  function fillDown(field: string) {
    if (targetRows.length === 0) return;
    // Only ever fill from the row the user actually put the cursor in. It used
    // to fall back to the first target row, so if the focused row had scrolled
    // out of view or was not in the selection it silently copied a value
    // nobody chose — across every selected product.
    const source = targetRows.find((r) => r.id === activeRowIdRef.current);
    if (!source) {
      toast.error("Click the cell you want to copy from first");
      return;
    }
    const value = cellValue(source, layer, field);
    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of targetRows) {
        const key = dkey(row.id, layer, field);
        if (value === originalValue(row, layer, field)) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
    toast.success(
      `Filled "${field}" to ${targetRows.length} rows` +
        (layer === "BASE" ? "" : ` as ${layer} overrides`)
    );
  }

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
        changes.push({
          colorwayId: id,
          field,
          layer: l,
          value,
          ...(field === "priceNok" && seasonId ? { seasonId } : {}),
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

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col px-6 py-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Bulk editor</h1>
        <div className="flex gap-1.5">
          <a
            href="/catalog/edit"
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              !season
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            All
          </a>
          {seasons.map((s) => (
            <a
              key={s.code}
              href={`/catalog/edit?season=${s.code}`}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                season === s.code
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {s.code}
            </a>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(["BASE", ...CHANNELS, "REFERENCES"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                view === v
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {v === "BASE"
                ? "Base"
                : v === "REFERENCES"
                  ? "References"
                  : CHANNEL_LABELS[v as "SHOPIFY" | "LOOM"]}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by style, colorway, SKU…"
          className="h-8 w-64"
        />
        <div className="flex gap-1" title="Filter by Threadflow dropped status">
          {(["all", "active", "dropped"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDroppedFilter(f)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
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
              className="text-xs font-medium text-muted-foreground underline underline-offset-4"
            >
              Clear {selected.size} selected
            </button>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {selected.size > 0 && `${selected.size} selected · `}
            {visibleRows.length} rows · {dirty.size} unsaved
          </span>
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
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
        {season && (
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
              setFilters({ vendor: "", productType: "", gender: "", status: "", source: "", needs: "", drop: "", origin: "" })
            }
            className="text-xs font-medium text-muted-foreground underline underline-offset-4"
          >
            Clear filters
          </button>
        )}
      </div>

      {!seasonId && (
        <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-500">
          Prices are per-season — select a season above to edit NOK prices.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Tip: click a description, details or tagline cell to write it in a full
        panel — and apply it to a whole selection from there · <b>Enter</b> /{" "}
        <b>Shift+Enter</b> move down/up a column · paste a tab-separated block
        from a spreadsheet into any cell · <b>↓</b> copies the cell you are in
        down the selection.
      </p>
      {selected.size > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-blue-600 dark:text-blue-400">
            {selected.size} selected — fill-down (↓) and bulk actions apply to
            these rows. Shift-click a checkbox to select a range.
          </p>
          <AddTagToSelected count={selected.size} onAdd={addTagToSelected} />
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
            className="h-7 rounded border px-2 text-xs font-medium hover:bg-muted"
            title="Take the description and other fields off a product that is already written"
          >
            Copy fields from a product…
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs font-medium text-muted-foreground underline underline-offset-4"
          >
            Clear selection
          </button>
        </div>
      )}
      {!isBase && !isRefs && (
        <p className="mt-2 text-xs text-muted-foreground">
          Editing <b>{CHANNEL_LABELS[layer as "SHOPIFY" | "LOOM"]}</b> overrides.
          Empty cells inherit the base value (shown as placeholder).
        </p>
      )}
      {isRefs && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            References. Edit inline, fill-down (↓), or use the bulk bar. Bulk
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
        className="mt-3 flex-1 overflow-auto rounded-lg border"
      >
        <div style={{ width: totalWidth, position: "relative" }}>
          {/* Header */}
          <div
            className="sticky top-0 z-10 flex border-b bg-muted/60 text-xs font-medium text-muted-foreground backdrop-blur"
            style={{ width: totalWidth }}
          >
            <div
              style={{ width: SELECT_W }}
              className="flex shrink-0 items-center justify-center"
            >
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                title="Select all filtered rows"
              />
            </div>
            <div style={{ width: LABEL_W }} className="shrink-0 border-l px-3 py-2">
              Style · Colorway
            </div>
            {FIXED_COLS.map((c) => (
              <div
                key={c.key}
                style={{ width: c.width }}
                className="shrink-0 border-l px-2 py-2"
              >
                {c.label}
              </div>
            ))}
            {(isRefs ? [...REF_SINGLE, ...REF_MULTI] : columns).map((c) => (
              <div
                key={c.key}
                style={{ width: c.width }}
                className="flex shrink-0 items-center justify-between gap-1 border-l px-2 py-2"
              >
                <span className="truncate">{c.label}</span>
                <button
                  title="Fill down to all visible rows"
                  onClick={() => fillDown(c.key as string)}
                  className="rounded px-1 text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  ↓
                </button>
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
                    "absolute left-0 flex border-b hover:bg-muted/20",
                    isSel && "bg-blue-500/10 hover:bg-blue-500/15"
                  )}
                  style={{
                    top: vi.start,
                    height: ROW_H,
                    width: totalWidth,
                  }}
                >
                  <div
                    style={{ width: SELECT_W }}
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
                  {/* Frozen-ish label block */}
                  <div
                    style={{ width: LABEL_W }}
                    className="flex shrink-0 items-center gap-2 border-l px-3"
                  >
                    <div className="h-6 w-6 shrink-0 overflow-hidden rounded bg-muted">
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
                        className="block truncate text-xs font-medium hover:underline"
                      >
                        {row.dropped && (
                          <span
                            title="Dropped from Threadflow for this season"
                            className="mr-1 rounded bg-amber-500/20 px-1 text-[9px] font-semibold uppercase text-amber-700 dark:text-amber-500"
                          >
                            dropped
                          </span>
                        )}
                        {row.name}
                      </a>
                      <span className="block truncate text-[10px] text-muted-foreground">
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
                        {row.onShopify && (
                          <span
                            title="Already has a Shopify product — a push updates it"
                            className="ml-1 uppercase"
                          >
                            · live
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Always-visible: swatch, price, media */}
                  <div
                    style={{ width: FIXED_COLS[0].width }}
                    className={cn(
                      "flex shrink-0 items-center gap-1 border-l px-1",
                      dirty.has(dkey(row.id, "BASE", "swatchHex")) && "bg-amber-500/10"
                    )}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded border"
                      style={{ backgroundColor: cellValue(row, "BASE", "swatchHex") || "transparent" }}
                    />
                    <input
                      {...cellHandlers(vi.index, row, "swatchHex", "text")}
                      value={cellValue(row, "BASE", "swatchHex")}
                      placeholder="#hex"
                      onChange={(e) => setCell(row, "swatchHex", e.target.value, "BASE")}
                      className="w-full bg-transparent text-xs outline-none focus:bg-background"
                    />
                  </div>
                  <div
                    style={{ width: FIXED_COLS[1].width }}
                    className={cn(
                      "shrink-0 border-l",
                      dirty.has(dkey(row.id, "BASE", "priceNok")) && "bg-amber-500/10"
                    )}
                  >
                    <input
                      {...cellHandlers(vi.index, row, "priceNok", "text")}
                      value={cellValue(row, "BASE", "priceNok")}
                      disabled={!seasonId}
                      placeholder={seasonId ? "NOK" : "season"}
                      onChange={(e) => setCell(row, "priceNok", e.target.value, "BASE")}
                      title={seasonId ? "NOK MSRP for this season" : "Select a season to edit price"}
                      className="h-full w-full bg-transparent px-2 text-xs tabular-nums outline-none focus:bg-background disabled:opacity-40"
                    />
                  </div>
                  <a
                    href={`/catalog/colorways/${row.id}/media`}
                    style={{ width: FIXED_COLS[2].width }}
                    className="flex shrink-0 items-center justify-center gap-1 border-l text-xs text-muted-foreground hover:bg-muted hover:underline"
                    title="Manage media"
                  >
                    ▦ {row.mediaCount}
                  </a>

                  {/* Editable cells */}
                  {isRefs ? (
                    <>
                      {REF_SINGLE.map((c) => {
                        const value = cellValue(row, "BASE", c.key);
                        const isDirty = dirty.has(dkey(row.id, "BASE", c.key));
                        return (
                          <div
                            key={c.key}
                            style={{ width: c.width }}
                            className={cn("shrink-0 border-l", isDirty && "bg-amber-500/10")}
                          >
                            <select
                              {...cellHandlers(vi.index, row, c.key, "select")}
                              value={value}
                              onChange={(e) => setCell(row, c.key, e.target.value, "BASE")}
                              className="h-full w-full bg-transparent px-1 text-xs outline-none"
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
                      {REF_MULTI.map((c) => {
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
                            style={{ width: c.width }}
                            className={cn(
                              "flex shrink-0 items-center justify-between gap-1 border-l px-2 text-xs",
                              isDirty && "bg-amber-500/10"
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
                    columns.map((c) => {
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
                          style={{ width: c.width }}
                          className={cn(
                            "shrink-0 border-l",
                            isDirty && "bg-amber-500/10"
                          )}
                        >
                          {c.kind === "status" ? (
                            <select
                              {...(disabled ? {} : cellHandlers(vi.index, row, c.key, "select"))}
                              value={value}
                              disabled={disabled}
                              onChange={(e) => setCell(row, c.key, e.target.value)}
                              className="h-full w-full bg-transparent px-2 text-xs outline-none disabled:opacity-40"
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
                                  ? `${value}\n\nClick to edit · Delete to clear`
                                  : placeholder || "Click to write"
                              }
                              className={cn(
                                "h-full w-full truncate px-2 text-left text-xs hover:bg-muted/60 focus:bg-background focus:outline focus:outline-1 disabled:opacity-40",
                                !value && "text-muted-foreground/50"
                              )}
                            >
                              {value || placeholder || "—"}
                            </button>
                          ) : (
                            <input
                              {...(disabled ? {} : cellHandlers(vi.index, row, c.key, "text"))}
                              value={disabled ? originalValue(row, "BASE", c.key) : value}
                              disabled={disabled}
                              placeholder={placeholder}
                              onChange={(e) => setCell(row, c.key, e.target.value)}
                              className="h-full w-full bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-background disabled:opacity-40"
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
          className="h-7 rounded border px-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
          title="Copy chosen fields from one selected row to the rest, or clear them"
        >
          Copy down / clear…
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Which fields?</p>
          <p className="text-xs text-muted-foreground">
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
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
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
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            Select all
          </button>
          <button
            onClick={() => run(onClear)}
            disabled={!chosen.size || selectedCount < 1}
            className="ml-auto rounded border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"
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
      <span className="text-xs font-medium text-destructive" title={error}>
        Not saved — {pending} pending
      </span>
    );
  if (saving) return <span className="text-xs text-muted-foreground">Saving…</span>;
  if (pending > 0)
    return (
      <span className="text-xs text-amber-700 dark:text-amber-500">
        {autosave ? "Saving shortly…" : `${pending} unsaved`}
      </span>
    );
  if (savedAt)
    return (
      <span className="text-xs text-muted-foreground">
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
        className="h-7 w-32 rounded border bg-transparent px-2 text-xs"
      />
      <button
        onClick={submit}
        disabled={!tag.trim()}
        className="h-7 rounded border px-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
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
        "h-8 rounded-md border bg-transparent px-2 text-xs",
        value ? "border-foreground font-medium" : "text-muted-foreground"
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
      <span className="px-1 text-xs font-medium">Bulk set</span>
      <select
        value={fieldKey}
        onChange={(e) => changeField(e.target.value)}
        className="h-8 rounded-md border bg-transparent px-2 text-xs"
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
          <div className="absolute z-20 mt-1 w-64 overflow-hidden rounded-md border bg-background shadow-md">
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
                className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted"
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
            <span key={id} className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px]">
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
                "rounded-full border px-2.5 py-1 text-xs capitalize",
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
      if (ch.field === "status") row.status = v;
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
