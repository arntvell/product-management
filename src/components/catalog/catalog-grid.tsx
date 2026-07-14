"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CHANNELS,
  CHANNEL_LABELS,
  PRODUCT_STATUSES,
} from "@/lib/master/fields";
import { catalogImageSrc } from "@/lib/catalog-image";
import type { GridRow } from "@/lib/master/queries";
import type { BulkChange, EditLayer } from "@/lib/master/edit";

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

const LABEL_W = 320; // frozen-ish left block (img + style + colorway)
const ROW_H = 40;

function dkey(id: string, layer: EditLayer, field: string) {
  return `${id}|${layer}|${field}`;
}

export function CatalogGrid({
  initialRows,
  seasons,
  season,
}: {
  initialRows: GridRow[];
  seasons: { code: string }[];
  season?: string;
}) {
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [layer, setLayer] = useState<EditLayer>("BASE");
  const [dirty, setDirty] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
  const [droppedFilter, setDroppedFilter] = useState<"all" | "active" | "dropped">("all");
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isBase = layer === "BASE";
  const columns = isBase ? COLUMNS : COLUMNS.filter((c) => c.split);
  const totalWidth =
    LABEL_W + columns.reduce((sum, c) => sum + c.width, 0);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (droppedFilter === "active" && r.dropped) return false;
      if (droppedFilter === "dropped" && !r.dropped) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.styleName.toLowerCase().includes(q) ||
        r.colorwaySku.toLowerCase().includes(q)
      );
    });
  }, [rows, search, droppedFilter]);

  const droppedCount = rows.filter((r) => r.dropped).length;

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // ---- value resolution ----
  function originalValue(row: GridRow, l: EditLayer, field: string): string {
    if (l === "BASE") {
      if (field === "status") return row.status;
      if (field === "tags") return row.tags.join(", ");
      if (field === "vendor") return row.vendor;
      if (field === "productType") return row.productType;
      return row.base[field] ?? "";
    }
    return row.overrides[l][field] ?? "";
  }

  function cellValue(row: GridRow, l: EditLayer, field: string): string {
    const d = dirty.get(dkey(row.id, l, field));
    return d !== undefined ? d : originalValue(row, l, field);
  }

  function setCell(row: GridRow, field: string, value: string) {
    setDirty((prev) => {
      const next = new Map(prev);
      const key = dkey(row.id, layer, field);
      if (value === originalValue(row, layer, field)) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  // ---- fill down: copy the top visible row's value to all visible rows ----
  function fillDown(field: string) {
    if (visibleRows.length === 0) return;
    const source = visibleRows[0];
    const value = cellValue(source, layer, field);
    setDirty((prev) => {
      const next = new Map(prev);
      for (const row of visibleRows) {
        const key = dkey(row.id, layer, field);
        if (value === originalValue(row, layer, field)) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
    toast.success(`Filled "${field}" to ${visibleRows.length} rows`);
  }

  // ---- save ----
  async function save() {
    if (dirty.size === 0) return;
    setSaving(true);
    const changes: BulkChange[] = [];
    for (const [key, value] of dirty) {
      const [id, l, field] = key.split("|") as [string, EditLayer, string];
      changes.push({ colorwayId: id, field, layer: l, value });
    }
    try {
      const res = await fetch("/api/catalog/colorways/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
      // Apply saved changes to local rows, then clear dirty.
      setRows((prev) => applyChanges(prev, changes));
      setDirty(new Map());
      toast.success(`Saved ${data.changes} changes across ${data.colorways} colorways`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

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
          {(["BASE", ...CHANNELS] as EditLayer[]).map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                layer === l
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {l === "BASE" ? "Base" : CHANNEL_LABELS[l as "SHOPIFY" | "LOOM"]}
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
          <span className="text-xs text-muted-foreground tabular-nums">
            {visibleRows.length} rows · {dirty.size} unsaved
          </span>
          <Button size="sm" onClick={save} disabled={saving || dirty.size === 0}>
            {saving ? "Saving…" : `Save ${dirty.size || ""}`.trim()}
          </Button>
        </div>
      </div>

      {!isBase && (
        <p className="mt-2 text-xs text-muted-foreground">
          Editing <b>{CHANNEL_LABELS[layer as "SHOPIFY" | "LOOM"]}</b> overrides.
          Empty cells inherit the base value (shown as placeholder).
        </p>
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
            <div style={{ width: LABEL_W }} className="shrink-0 px-3 py-2">
              Style · Colorway
            </div>
            {columns.map((c) => (
              <div
                key={c.key}
                style={{ width: c.width }}
                className="flex shrink-0 items-center justify-between gap-1 border-l px-2 py-2"
              >
                <span className="truncate">{c.label}</span>
                <button
                  title="Fill down to all visible rows"
                  onClick={() => fillDown(c.key)}
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
              return (
                <div
                  key={row.id}
                  className="absolute left-0 flex border-b hover:bg-muted/20"
                  style={{
                    top: vi.start,
                    height: ROW_H,
                    width: totalWidth,
                  }}
                >
                  {/* Frozen-ish label block */}
                  <div
                    style={{ width: LABEL_W }}
                    className="flex shrink-0 items-center gap-2 px-3"
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
                      </span>
                    </div>
                  </div>

                  {/* Editable cells */}
                  {columns.map((c) => {
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
                        ) : (
                          <input
                            value={disabled ? originalValue(row, "BASE", c.key) : value}
                            disabled={disabled}
                            placeholder={placeholder}
                            onChange={(e) => setCell(row, c.key, e.target.value)}
                            className="h-full w-full bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:bg-background disabled:opacity-40"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Apply saved changes to the in-memory rows so the grid reflects them.
function applyChanges(rows: GridRow[], changes: BulkChange[]): GridRow[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r, base: { ...r.base }, overrides: { SHOPIFY: { ...r.overrides.SHOPIFY }, LOOM: { ...r.overrides.LOOM } } }]));
  for (const ch of changes) {
    const row = byId.get(ch.colorwayId);
    if (!row) continue;
    const v = typeof ch.value === "string" ? ch.value : "";
    if (ch.layer === "BASE") {
      if (ch.field === "status") row.status = v;
      else if (ch.field === "tags")
        row.tags = v.split(",").map((t) => t.trim()).filter(Boolean);
      else if (ch.field === "vendor") row.vendor = v;
      else if (ch.field === "productType") row.productType = v;
      else row.base[ch.field] = v;
    } else {
      if (v.trim()) row.overrides[ch.layer][ch.field] = v;
      else delete row.overrides[ch.layer][ch.field];
    }
  }
  return [...byId.values()];
}
