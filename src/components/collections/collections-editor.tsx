"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  CollectionMetafieldDef,
  CollectionResult,
  LiveCollection,
} from "@/lib/shopify/live-collections";

// The Collections module of the live store editor.
//
// Every collection on the store in one grid: its own fields (title, handle,
// sort order, template, SEO, description) and every collection metafield the
// store defines, as columns. Edits collect as pending changes, highlighted, and
// nothing is written until "Review" shows them and the write is confirmed —
// this screen changes the live store, there is no push step after it.

interface Payload {
  defs: CollectionMetafieldDef[];
  collections: LiveCollection[];
  adminBase: string | null;
}

/** Fields of the collection itself that the grid edits, by column key. */
const FIELD_COLS = [
  { key: "title", label: "Title", width: 220 },
  { key: "handle", label: "Handle", width: 180 },
  { key: "sortOrder", label: "Sort order", width: 140 },
  { key: "templateSuffix", label: "Template", width: 120 },
  { key: "seoTitle", label: "SEO title", width: 200 },
  { key: "seoDescription", label: "SEO description", width: 240 },
  { key: "descriptionHtml", label: "Description", width: 130 },
] as const;
type FieldKey = (typeof FIELD_COLS)[number]["key"];

const SORT_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  BEST_SELLING: "Best selling",
  ALPHA_ASC: "A–Z",
  ALPHA_DESC: "Z–A",
  PRICE_DESC: "Price high–low",
  PRICE_ASC: "Price low–high",
  CREATED: "Oldest first",
  CREATED_DESC: "Newest first",
};

/** Pending edits for one collection. */
interface Pending {
  fields: Partial<Record<FieldKey, string>>;
  metafields: Record<string, string>;
}

interface Filters {
  q: string;
  type: string[];
  published: string[];
  sortOrder: string[];
  missing: string[];
}
const DEFAULT_FILTERS: Filters = { q: "", type: [], published: ["Published"], sortOrder: [], missing: [] };
const FILTER_KEY = "origo:live-collections:filters";
const COLS_KEY = "origo:live-collections:hidden";

const mfCol = (d: CollectionMetafieldDef) => `mf:${d.id}`;

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** datetime-local wants "2026-10-12T17:00"; Shopify stores ISO with a zone. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function CollectionsEditor() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<Payload>({
    queryKey: ["live-collections"],
    queryFn: async () => {
      const res = await fetch("/api/live-collections");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load collections");
      return json;
    },
    staleTime: 60_000,
  });

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingDescription, setEditingDescription] = useState<LiveCollection | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<Map<string, string[]>>(new Map());
  const [bulk, setBulk] = useState<{ col: string; value: string }>({ col: "", value: "" });

  // Filters and hidden columns survive leaving the page, like the grids.
  useEffect(() => {
    setFilters(readSession(FILTER_KEY, DEFAULT_FILTERS));
    try {
      const raw = localStorage.getItem(COLS_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw)));
    } catch {
      /* defaults */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* fine */
    }
  }, [filters]);
  const toggleColumn = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLS_KEY, JSON.stringify([...next]));
      } catch {
        /* fine */
      }
      return next;
    });

  const defs = useMemo(() => data?.defs ?? [], [data]);
  const collections = useMemo(() => data?.collections ?? [], [data]);

  // ---- values ---------------------------------------------------------------
  const original = useCallback((c: LiveCollection, col: string): string => {
    if (col.startsWith("mf:")) return c.metafields[col.slice(3)] ?? "";
    return String(c[col as FieldKey] ?? "");
  }, []);
  const value = useCallback(
    (c: LiveCollection, col: string): string => {
      const p = pending.get(c.id);
      if (col.startsWith("mf:")) {
        const k = col.slice(3);
        return p && k in p.metafields ? p.metafields[k] : original(c, col);
      }
      const f = col as FieldKey;
      return p && p.fields[f] !== undefined ? (p.fields[f] as string) : original(c, col);
    },
    [pending, original]
  );
  const isDirty = (c: LiveCollection, col: string) => {
    const p = pending.get(c.id);
    if (!p) return false;
    return col.startsWith("mf:") ? col.slice(3) in p.metafields : p.fields[col as FieldKey] !== undefined;
  };

  const setValue = useCallback(
    (c: LiveCollection, col: string, v: string) => {
      setPending((prev) => {
        const next = new Map(prev);
        const p: Pending = {
          fields: { ...(next.get(c.id)?.fields ?? {}) },
          metafields: { ...(next.get(c.id)?.metafields ?? {}) },
        };
        const same = v === original(c, col);
        if (col.startsWith("mf:")) {
          const k = col.slice(3);
          if (same) delete p.metafields[k];
          else p.metafields[k] = v;
        } else {
          const f = col as FieldKey;
          if (same) delete p.fields[f];
          else p.fields[f] = v;
        }
        if (!Object.keys(p.fields).length && !Object.keys(p.metafields).length) next.delete(c.id);
        else next.set(c.id, p);
        return next;
      });
    },
    [original]
  );

  // ---- filtering ------------------------------------------------------------
  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return collections.filter((c) => {
      if (q && !c.title.toLowerCase().includes(q) && !c.handle.includes(q)) return false;
      if (filters.type.length && !filters.type.includes(c.rules ? "Smart (rules)" : "Manual")) return false;
      if (filters.published.length && !filters.published.includes(c.published ? "Published" : "Not published"))
        return false;
      if (filters.sortOrder.length && !filters.sortOrder.includes(SORT_LABELS[c.sortOrder] ?? c.sortOrder))
        return false;
      for (const name of filters.missing) {
        const d = defs.find((x) => x.name === name);
        if (d && (c.metafields[d.id] ?? "").trim()) return false;
        if (name === "SEO title" && c.seoTitle.trim()) return false;
        if (name === "SEO description" && c.seoDescription.trim()) return false;
        if (name === "Description" && c.descriptionHtml.trim()) return false;
        if (name === "Image" && c.image) return false;
      }
      return true;
    });
  }, [collections, filters, defs]);

  // ---- columns --------------------------------------------------------------
  const allCols = useMemo(
    () => [
      ...FIELD_COLS.map((c) => ({ key: c.key as string, label: c.label, width: c.width as number })),
      ...defs.map((d) => ({ key: mfCol(d), label: d.name, width: d.type === "boolean" ? 120 : d.type === "date_time" ? 200 : 180 })),
    ],
    [defs]
  );
  const shownCols = allCols.filter((c) => !hidden.has(c.key) || c.key === "title");

  const pendingCount = [...pending.values()].reduce(
    (a, p) => a + Object.keys(p.fields).length + Object.keys(p.metafields).length,
    0
  );

  // ---- bulk -----------------------------------------------------------------
  function applyBulk() {
    if (!bulk.col || !selected.size) return;
    const targets = collections.filter((c) => selected.has(c.id));
    for (const c of targets) setValue(c, bulk.col, bulk.value);
    toast.success(`Set on ${targets.length} collection(s) — review to write them.`);
  }

  // ---- save -----------------------------------------------------------------
  async function save() {
    setSaving(true);
    try {
      const changes = [...pending].map(([id, p]) => ({
        id,
        fields: p.fields,
        metafields: p.metafields,
      }));
      const res = await fetch("/api/live-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const json = (await res.json()) as { results?: CollectionResult[]; error?: string };
      if (!res.ok || !json.results) throw new Error(json.error ?? "Save failed");
      const failed = json.results.filter((r) => !r.ok);
      // What went through stops being pending; what failed stays, with why.
      setPending((prev) => {
        const next = new Map(prev);
        for (const r of json.results!) if (r.ok) next.delete(r.id);
        return next;
      });
      setFailures(new Map(failed.map((r) => [r.id, r.errors])));
      if (failed.length)
        toast.error(`${json.results.length - failed.length} saved, ${failed.length} refused by Shopify — see the marked rows.`);
      else toast.success(`Saved ${json.results.length} collection(s) on the live store.`);
      setReviewing(false);
      await qc.invalidateQueries({ queryKey: ["live-collections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ---- render ---------------------------------------------------------------
  const filterOptions = {
    type: ["Smart (rules)", "Manual"],
    published: ["Published", "Not published"],
    sortOrder: [...new Set(collections.map((c) => SORT_LABELS[c.sortOrder] ?? c.sortOrder))].sort(),
    missing: ["Image", "Description", "SEO title", "SEO description", ...defs.map((d) => d.name)],
  };
  const filtered =
    filters.q || filters.type.length || filters.sortOrder.length || filters.missing.length ||
    filters.published.join() !== DEFAULT_FILTERS.published.join();

  if (isLoading) return <p className="px-8 py-6 text-body text-muted-foreground">Reading collections from Shopify…</p>;
  if (error) return <p className="px-8 py-6 text-body text-ink">{(error as Error).message}</p>;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3 px-8 pb-24">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Search title or handle"
          className="h-8 w-56"
        />
        <MultiSelect
          options={filterOptions.published}
          selected={filters.published}
          onChange={(v) => setFilters((f) => ({ ...f, published: v }))}
          placeholder="Published"
        />
        <MultiSelect
          options={filterOptions.type}
          selected={filters.type}
          onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
          placeholder="Type"
        />
        <MultiSelect
          options={filterOptions.sortOrder}
          selected={filters.sortOrder}
          onChange={(v) => setFilters((f) => ({ ...f, sortOrder: v }))}
          placeholder="Sort order"
        />
        <MultiSelect
          options={filterOptions.missing}
          selected={filters.missing}
          onChange={(v) => setFilters((f) => ({ ...f, missing: v }))}
          placeholder="Missing…"
        />
        {filtered ? (
          <button
            type="button"
            className="text-fine text-muted-foreground underline underline-offset-4"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            Reset
          </button>
        ) : null}
        <span className="ml-auto text-fine text-muted-foreground">
          {rows.length} of {collections.length}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline">
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="space-y-1">
              {allCols
                .filter((c) => c.key !== "title")
                .map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-body">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["live-collections"] })}>
          Reload
        </Button>
      </div>

      {/* Bulk */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border bg-muted/40 px-3 py-2 text-body">
          <span>{selected.size} selected</span>
          <span className="text-muted-foreground">· set</span>
          <select
            className="h-8 border bg-background px-2 text-body"
            value={bulk.col}
            onChange={(e) => setBulk({ col: e.target.value, value: "" })}
          >
            <option value="">choose a column</option>
            {allCols
              .filter((c) => !["title", "handle", "descriptionHtml"].includes(c.key))
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
          </select>
          {bulk.col ? (
            <>
              <span className="text-muted-foreground">to</span>
              <span className="w-56">
                <CellEditor
                  col={bulk.col}
                  defs={defs}
                  value={bulk.value}
                  onChange={(v) => setBulk((b) => ({ ...b, value: v }))}
                />
              </span>
              <Button size="sm" onClick={applyBulk}>
                Apply to {selected.size}
              </Button>
            </>
          ) : null}
          <button
            type="button"
            className="ml-auto text-fine text-muted-foreground underline underline-offset-4"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {/* Grid */}
      <div className="overflow-auto border" style={{ maxHeight: "calc(100vh - 15rem)" }}>
        <table className="border-collapse text-fine">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="sticky left-0 z-20 w-8 bg-muted px-2 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                  aria-label="Select all shown"
                />
              </th>
              <th className="px-2 py-2 text-left font-normal text-muted-foreground" style={{ minWidth: 56 }}>
                Image
              </th>
              {shownCols.map((c) => (
                <th key={c.key} className="px-2 py-2 text-left font-normal text-muted-foreground" style={{ minWidth: c.width }}>
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2 text-left font-normal text-muted-foreground" style={{ minWidth: 120 }}>
                Type
              </th>
              <th className="px-2 py-2 text-right font-normal text-muted-foreground">Products</th>
              <th className="px-2 py-2 text-left font-normal text-muted-foreground">Published</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const fail = failures.get(c.id);
              return (
                <tr key={c.id} className={cn("border-t align-middle", fail && "bg-destructive/5")}>
                  <td className="sticky left-0 bg-background px-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        })
                      }
                      aria-label={`Select ${c.title}`}
                    />
                  </td>
                  <td className="px-2 py-1">
                    {c.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${c.image.url}${c.image.url.includes("?") ? "&" : "?"}width=80`} alt={c.image.altText ?? ""} className="size-9 border object-cover" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {shownCols.map((col) => (
                    <td
                      key={col.key}
                      className={cn("border-l px-1 py-0.5", isDirty(c, col.key) && "bg-amber-50 dark:bg-amber-950/30")}
                      title={col.key === "title" && fail ? fail.join("\n") : undefined}
                    >
                      {col.key === "descriptionHtml" ? (
                        <button
                          type="button"
                          className="w-full truncate px-1 text-left underline-offset-4 hover:underline"
                          onClick={() => setEditingDescription(c)}
                        >
                          {value(c, col.key).trim() ? "Edit…" : <span className="text-muted-foreground">Add…</span>}
                        </button>
                      ) : (
                        <CellEditor
                          col={col.key}
                          defs={defs}
                          value={value(c, col.key)}
                          onChange={(v) => setValue(c, col.key, v)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="border-l px-2" title={c.rules ? rulesText(c) : "Products are added by hand"}>
                    {c.rules ? `Smart · ${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}` : "Manual"}
                  </td>
                  <td className="border-l px-2 text-right tabular-nums">{c.productsCount}</td>
                  <td className="border-l px-2">{c.published ? "Yes" : <span className="text-ink">No</span>}</td>
                  <td className="border-l px-2">
                    {data?.adminBase ? (
                      <a
                        href={`${data.adminBase}/collections/${c.id.split("/").pop()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="whitespace-nowrap underline underline-offset-4"
                      >
                        Shopify ↗
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={shownCols.length + 6} className="px-3 py-8 text-center text-body text-muted-foreground">
                  No collections match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Save bar */}
      {pendingCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-end gap-3 border-t bg-background/95 px-8 py-3 backdrop-blur">
          <span className="text-body text-muted-foreground">
            {pendingCount} change{pendingCount === 1 ? "" : "s"} on {pending.size} collection
            {pending.size === 1 ? "" : "s"} — not on the store yet
          </span>
          <Button variant="outline" onClick={() => setPending(new Map())}>
            Discard
          </Button>
          <Button onClick={() => setReviewing(true)}>Review and save</Button>
        </div>
      ) : null}

      {/* Review */}
      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Write to the live store?</DialogTitle>
            <DialogDescription>
              These go to Shopify straight away. A changed handle keeps a redirect from the old address.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-3 overflow-auto text-fine">
            {[...pending].map(([id, p]) => {
              const c = collections.find((x) => x.id === id);
              if (!c) return null;
              return (
                <div key={id} className="border p-2">
                  <div className="text-body">{c.title}</div>
                  {[
                    ...Object.entries(p.fields).map(([k, v]) => [k, v as string] as const),
                    ...Object.entries(p.metafields).map(([k, v]) => [`mf:${k}`, v] as const),
                  ].map(([col, v]) => (
                    <div key={col} className="mt-0.5 grid grid-cols-[9rem_1fr] gap-2">
                      <span className="text-muted-foreground">{allCols.find((x) => x.key === col)?.label ?? col}</span>
                      <span className="min-w-0 break-words">
                        <span className="text-muted-foreground line-through">{short(original(c, col)) || "empty"}</span>
                        {" → "}
                        {short(v) || <em>cleared</em>}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(false)} disabled={saving}>
              Back
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Writing…" : `Write ${pendingCount} change${pendingCount === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Description */}
      <Dialog open={!!editingDescription} onOpenChange={(o) => !o && setEditingDescription(null)}>
        <DialogContent className="max-w-2xl">
          {editingDescription ? (
            <DescriptionEditor
              key={editingDescription.id}
              collection={editingDescription}
              initial={value(editingDescription, "descriptionHtml")}
              onDone={(v) => {
                if (v !== null) setValue(editingDescription, "descriptionHtml", v);
                setEditingDescription(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function short(v: string): string {
  const t = v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

function rulesText(c: LiveCollection): string {
  if (!c.rules) return "";
  const joiner = c.disjunctive ? " OR " : " AND ";
  return (
    "Products join automatically when: " +
    c.rules.map((r) => `${r.column.toLowerCase()} ${r.relation.toLowerCase().replace(/_/g, " ")} "${r.condition}"`).join(joiner) +
    ". Edit rules in Shopify."
  );
}

/** The editor a cell gets, by what it holds. */
function CellEditor({
  col,
  defs,
  value,
  onChange,
}: {
  col: string;
  defs: CollectionMetafieldDef[];
  value: string;
  onChange: (v: string) => void;
}) {
  const cell = "h-7 w-full bg-transparent px-1 text-fine outline-none focus:bg-background focus:ring-1 focus:ring-ring";
  if (col === "sortOrder")
    return (
      <select className={cell} value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(SORT_LABELS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    );
  if (col.startsWith("mf:")) {
    const def = defs.find((d) => d.id === col.slice(3));
    if (def?.type === "boolean")
      return (
        <select className={cell} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    if (def?.type === "date_time")
      return (
        <input
          type="datetime-local"
          className={cell}
          value={toLocalInput(value)}
          onChange={(e) => onChange(fromLocalInput(e.target.value))}
        />
      );
    if (def?.type === "number_integer" || def?.type === "number_decimal")
      return <input inputMode="decimal" className={cell} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className={cell} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function DescriptionEditor({
  collection,
  initial,
  onDone,
}: {
  collection: LiveCollection;
  initial: string;
  onDone: (v: string | null) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{collection.title} — description</DialogTitle>
        <DialogDescription>HTML, as Shopify stores it. Kept as a pending change until you save.</DialogDescription>
      </DialogHeader>
      <Textarea value={v} onChange={(e) => setV(e.target.value)} className="min-h-[16rem] font-mono text-fine" />
      <DialogFooter>
        <Button variant="outline" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button onClick={() => onDone(v)}>Keep</Button>
      </DialogFooter>
    </>
  );
}
