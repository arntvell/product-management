"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DropRow, DropSummary } from "@/lib/master/drops";

type Field =
  | "fullDescription"
  | "styleTagline"
  | "details"
  | "swatchHex"
  | "tags"
  | "carePageId"
  | "fitguidePageId"
  | "modelInfoId";

/** Fields worth setting on many products at once — the same for most of a drop. */
const BULK_FIELDS: { field: Field; label: string; hint?: string }[] = [
  { field: "carePageId", label: "Care page", hint: "gid://shopify/Page/…" },
  { field: "fitguidePageId", label: "Fit guide", hint: "gid://shopify/Page/…" },
  { field: "modelInfoId", label: "Model info", hint: "gid://shopify/Metaobject/…" },
  { field: "styleTagline", label: "Tagline" },
  { field: "details", label: "Details" },
  { field: "tags", label: "Tags", hint: "comma separated" },
];

/** What the server could and could not do with a pasted list of handles. */
interface HandleResult {
  updated: number;
  matched: { handle: string; colorwaySku: string }[];
  unmatched: string[];
  archived: { handle: string; colorwaySku: string }[];
  notInSeason: { handle: string; colorwaySku: string }[];
  ambiguous: { handle: string; colorwaySkus: string[] }[];
}

const GAP_LABEL: Record<string, string> = {
  description: "description",
  image: "image",
  tags: "tags",
  swatch: "swatch",
  "care page": "care page",
  "fit guide": "fit guide",
  variants: "sizes",
  price: "price",
};

export function DropBoard({
  season,
  drops,
  rows: initialRows,
  selectedDrop,
  fieldGaps,
}: {
  season: string;
  drops: DropSummary[];
  rows: DropRow[];
  selectedDrop: string | null | undefined;
  fieldGaps: { field: string; missing: number }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [bulkField, setBulkField] = useState<Field>("carePageId");
  const [bulkValue, setBulkValue] = useState("");
  const [dropValue, setDropValue] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteDrop, setPasteDrop] = useState("");
  const [pasteResult, setPasteResult] = useState<HandleResult | null>(null);

  // The server component re-renders with fresh rows after router.refresh().
  useEffect(() => setRows(initialRows), [initialRows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyBlocked && !r.missing.length) return false;
      if (!q) return true;
      // Everything you might reasonably recognise a product by.
      return [
        r.styleName,
        r.name,
        r.colorwaySku,
        r.productType,
        r.drop,
        r.values.tags.join(" "),
      ]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q));
    });
  }, [rows, onlyBlocked, query]);

  const readyCount = rows.filter((r) => !r.missing.length).length;
  const visibleIds = useMemo(() => new Set(visible.map((r) => r.colorwayId)), [visible]);
  const selectedVisible = [...selected].filter((id) => visibleIds.has(id)).length;
  // A selection can outlive the filter that made it. Say so rather than
  // silently acting on rows the user can no longer see.
  const selectedHidden = selected.size - selectedVisible;

  const allCheckbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allCheckbox.current)
      allCheckbox.current.indeterminate =
        selectedVisible > 0 && selectedVisible < visible.length;
  }, [selectedVisible, visible.length]);

  const dropHref = (d: string | null | undefined) =>
    d === undefined
      ? `/catalog/drops?season=${season}`
      : `/catalog/drops?season=${season}&drop=${encodeURIComponent(d ?? "")}`;

  async function saveFields(colorwayIds: string[], field: Field, value: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/colorways/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: colorwayIds.map((colorwayId) => ({
            colorwayId,
            field,
            layer: "BASE",
            value:
              field === "tags"
                ? value.split(",").map((t) => t.trim()).filter(Boolean)
                : value.trim() === ""
                  ? null
                  : value,
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Save failed");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Recompute what a row is missing, so the counts move as you type. */
  function applyLocal(ids: Set<string>, field: Field, value: string) {
    const filled = value.trim() !== "";
    const gapFor: Partial<Record<Field, string>> = {
      fullDescription: "description",
      swatchHex: "swatch",
      tags: "tags",
      carePageId: "care page",
      fitguidePageId: "fit guide",
    };
    setRows((prev) =>
      prev.map((r) => {
        if (!ids.has(r.colorwayId)) return r;
        const values = { ...r.values };
        if (field === "tags") values.tags = value.split(",").map((t) => t.trim()).filter(Boolean);
        else if (field === "fullDescription") values.description = value || null;
        else if (field === "swatchHex") values.swatchHex = value || null;
        else if (field === "carePageId") values.carePageId = value || null;
        else if (field === "fitguidePageId") values.fitguidePageId = value || null;
        else if (field === "modelInfoId") values.modelInfoId = value || null;
        else if (field === "styleTagline") values.styleTagline = value || null;
        else if (field === "details") values.details = value || null;
        const gap = gapFor[field];
        let missing = r.missing;
        if (gap) {
          missing = filled
            ? r.missing.filter((m) => m !== gap)
            : r.missing.includes(gap)
              ? r.missing
              : [...r.missing, gap];
        }
        return { ...r, values, missing };
      })
    );
  }

  async function applyBulk() {
    if (!selected.size) return toast.error("Select some products first");
    const label = BULK_FIELDS.find((b) => b.field === bulkField)?.label;
    if (!confirm(`Set ${label} on ${selected.size} product(s)?`)) return;
    if (await saveFields([...selected], bulkField, bulkValue)) {
      applyLocal(selected, bulkField, bulkValue);
      toast.success(`Updated ${selected.size} product(s)`);
      setBulkValue("");
    }
  }

  async function assignDrop(value: string | null) {
    if (!selected.size) return toast.error("Select some products first");
    const entryIds = rows.filter((r) => selected.has(r.colorwayId)).map((r) => r.entryId);
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds, drop: value }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      toast.success(
        value ? `Moved ${d.updated} product(s) to ${value}` : `Cleared drop on ${d.updated}`
      );
      setRows((prev) =>
        prev.map((r) => (selected.has(r.colorwayId) ? { ...r, drop: value } : r))
      );
      setDropValue("");
      // The drop tabs and their ready/total counts are server-derived.
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function assignByHandles() {
    if (!pasteText.trim()) return toast.error("Paste some handles first");
    setBusy(true);
    setPasteResult(null);
    try {
      const res = await fetch("/api/catalog/drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handles: pasteText,
          seasonCode: season,
          drop: pasteDrop.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setPasteResult(d as HandleResult);
      const target = pasteDrop.trim() || "no drop";
      if (d.updated) toast.success(`Moved ${d.updated} product(s) to ${target}`);
      else toast.error("Nothing matched — see the breakdown below");
      // Rows may now include products this view was not showing.
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Drop tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <a
          href={dropHref(undefined)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            selectedDrop === undefined
              ? "border-foreground bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          All {season}
        </a>
        {drops.map((d) => (
          <a
            key={d.label}
            href={dropHref(d.drop)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              selectedDrop === d.drop
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {d.label}{" "}
            <span className={selectedDrop === d.drop ? "text-background/70" : "text-muted-foreground/70"}>
              {d.ready}/{d.total}
            </span>
          </a>
        ))}
      </div>

      {/* What is blocking this view */}
      {fieldGaps.length > 0 && (
        <div className="mt-3 rounded-lg border bg-muted/20 p-3">
          <p className="text-sm">
            <b>{readyCount}</b> of {rows.length} ready to publish. Blocking, most common first:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {fieldGaps.map((g) => (
              <span
                key={g.field}
                className="rounded bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-400"
              >
                {GAP_LABEL[g.field] ?? g.field} · {g.missing}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Images come from photography, not from here — everything else can be set below,
            and the reference fields are usually the same for the whole drop.
          </p>
        </div>
      )}

      {/* Bulk bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium">
          {selected.size} selected
          {selectedHidden > 0 && (
            <span className="ml-1 font-normal text-muted-foreground">
              ({selectedHidden} hidden by filter)
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          disabled={!selected.size}
          className="rounded border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          Clear
        </button>
        <div className="h-4 w-px bg-border" />
        <input
          value={dropValue}
          onChange={(e) => setDropValue(e.target.value)}
          placeholder="Drop 1"
          className="w-24 rounded border bg-background px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => assignDrop(dropValue || null)}
          disabled={busy || !selected.size}
          className="rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
        >
          Move to drop
        </button>
        <button
          type="button"
          onClick={() => assignDrop(null)}
          disabled={busy || !selected.size}
          className="rounded border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          Unassign
        </button>
        <div className="h-4 w-px bg-border" />
        <select
          value={bulkField}
          onChange={(e) => {
            setBulkField(e.target.value as Field);
            setBulkValue("");
          }}
          className="rounded border bg-background px-2 py-1 text-xs"
        >
          {BULK_FIELDS.map((b) => (
            <option key={b.field} value={b.field}>
              {b.label}
            </option>
          ))}
        </select>
        <input
          value={bulkValue}
          onChange={(e) => setBulkValue(e.target.value)}
          placeholder={BULK_FIELDS.find((b) => b.field === bulkField)?.hint ?? "value"}
          className="min-w-56 flex-1 rounded border bg-background px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={applyBulk}
          disabled={busy || !selected.size || !bulkValue.trim()}
          className="rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-40"
        >
          Apply to selected
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search style, colour, SKU, type, tag…"
            className="w-72 rounded border bg-background px-2 py-1 pr-6 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {visible.length} of {rows.length} shown
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} />
          Only show products that are not ready
        </label>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="ml-auto rounded border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          {pasteOpen ? "Hide paste list" : "Assign by handle…"}
        </button>
      </div>

      {/* Assign a drop to a pasted list of handles. Resolved server-side against
          the whole catalogue, so it works from any tab and can name products
          this view is filtering out. */}
      {pasteOpen && (
        <div className="mt-2 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Paste Shopify handles, SKUs or product URLs — separated by commas,
            spaces or new lines. Case and punctuation do not matter.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder="liv-kr-jpn-blck, liv-kr-jpn-dwn, LIV-BX-BLCK-NPP"
            className="mt-2 w-full rounded border bg-background px-2 py-1 font-mono text-xs"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={pasteDrop}
              onChange={(e) => setPasteDrop(e.target.value)}
              placeholder="Drop 1"
              className="w-28 rounded border bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={assignByHandles}
              disabled={busy || !pasteText.trim()}
              className="rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-40"
            >
              {busy ? "Assigning…" : "Assign drop"}
            </button>
            <span className="text-xs text-muted-foreground">
              Leave the drop blank to clear it on the pasted products.
            </span>
          </div>

          {pasteResult && (
            <div className="mt-3 space-y-1.5 text-xs">
              <p className="font-medium">
                {pasteResult.updated} assigned
                {pasteResult.matched.length !== pasteResult.updated &&
                  ` (${pasteResult.matched.length} matched)`}
              </p>
              <HandleBucket
                label="not found"
                tone="bad"
                items={pasteResult.unmatched}
                hint="No product in the catalogue has this handle or SKU."
              />
              <HandleBucket
                label="archived"
                tone="warn"
                items={pasteResult.archived.map((a) => `${a.handle} → ${a.colorwaySku}`)}
                hint="The product exists but is retired, so it takes no drop."
              />
              <HandleBucket
                label={`not in ${season}`}
                tone="warn"
                items={pasteResult.notInSeason.map((a) => `${a.handle} → ${a.colorwaySku}`)}
                hint="A drop is a slice of one season, so the product needs a season entry first."
              />
              <HandleBucket
                label="ambiguous"
                tone="bad"
                items={pasteResult.ambiguous.map(
                  (a) => `${a.handle} → ${a.colorwaySkus.join(" / ")}`
                )}
                hint="Two live products share this handle; assign them from the grid instead."
              />
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-8 p-2">
                <input
                  ref={allCheckbox}
                  type="checkbox"
                  checked={visible.length > 0 && selectedVisible === visible.length}
                  // Any existing selection clears; only an empty one selects all.
                  // Otherwise a partial selection could never be undone here.
                  onChange={() =>
                    setSelected(
                      selected.size ? new Set() : new Set(visible.map((r) => r.colorwayId))
                    )
                  }
                />
              </th>
              <th className="p-2">Product</th>
              <th className="w-20 p-2">Drop</th>
              <th className="w-64 p-2">Description</th>
              <th className="w-40 p-2">Tags</th>
              <th className="w-24 p-2">Swatch</th>
              <th className="w-40 p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Row
                key={r.colorwayId}
                row={r}
                selected={selected.has(r.colorwayId)}
                busy={busy}
                onToggle={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.colorwayId)) next.delete(r.colorwayId);
                    else next.add(r.colorwayId);
                    return next;
                  })
                }
                onSave={async (field, value) => {
                  const ok = await saveFields([r.colorwayId], field, value);
                  if (ok) applyLocal(new Set([r.colorwayId]), field, value);
                  return ok;
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted-foreground">Nothing here.</p>
      )}
    </div>
  );
}

/** One reason-bucket from a pasted list. Hidden when empty. */
function HandleBucket({
  label,
  tone,
  items,
  hint,
}: {
  label: string;
  tone: "bad" | "warn";
  items: string[];
  hint: string;
}) {
  if (!items.length) return null;
  return (
    <div>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
          tone === "bad"
            ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-500"
        )}
      >
        {items.length} {label}
      </span>
      <span className="ml-1.5 text-muted-foreground">{hint}</span>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  row,
  selected,
  busy,
  onToggle,
  onSave,
}: {
  row: DropRow;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onSave: (field: Field, value: string) => Promise<boolean>;
}) {
  return (
    <tr className={cn("border-b align-top last:border-0", selected && "bg-muted/30")}>
      <td className="p-2">
        <input type="checkbox" checked={selected} onChange={onToggle} />
      </td>
      <td className="p-2">
        <div className="font-medium">
          {row.isCore && <span title="Core line">★ </span>}
          {row.styleName} · {row.name}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {row.colorwaySku} · {row.productType ?? "—"} · {row.variantCount} sizes ·{" "}
          {row.imageCount} image{row.imageCount === 1 ? "" : "s"}
        </div>
      </td>
      <td className="p-2 text-xs text-muted-foreground">{row.drop ?? "—"}</td>
      <Cell row={row} field="fullDescription" value={row.values.description} busy={busy} onSave={onSave} textarea />
      <Cell row={row} field="tags" value={row.values.tags.join(", ")} busy={busy} onSave={onSave} />
      <Cell row={row} field="swatchHex" value={row.values.swatchHex} busy={busy} onSave={onSave} />
      <td className="p-2">
        {row.missing.length === 0 ? (
          <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:text-green-500">
            ready
          </span>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            needs {row.missing.map((m) => GAP_LABEL[m] ?? m).join(", ")}
          </div>
        )}
        {row.publishedToShopify && (
          <div className="mt-1 text-[10px] uppercase text-muted-foreground">on shopify</div>
        )}
      </td>
    </tr>
  );
}

function Cell({
  row,
  field,
  value,
  busy,
  onSave,
  textarea,
}: {
  row: DropRow;
  field: Field;
  value: string | null;
  busy: boolean;
  onSave: (field: Field, value: string) => Promise<boolean>;
  textarea?: boolean;
}) {
  const persisted = value ?? "";
  const [draft, setDraft] = useState(persisted);
  const [last, setLast] = useState(persisted);
  if (last !== persisted) {
    setLast(persisted);
    setDraft(persisted);
  }
  const commit = async (next: string) => {
    if (next === persisted) return;
    // Put the field back if the write did not land — a cell showing a value the
    // database does not have is worse than an error.
    if (!(await onSave(field, next))) setDraft(persisted);
  };
  const cls = cn(
    "w-full rounded border bg-background px-1.5 py-1 text-xs",
    !persisted && "border-rose-500/50"
  );
  return (
    <td className="p-2">
      {textarea ? (
        <textarea
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          className={cls}
        />
      ) : (
        <input
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          className={cls}
        />
      )}
    </td>
  );
}
