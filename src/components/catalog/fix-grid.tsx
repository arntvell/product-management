"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FixRow } from "@/lib/master/fix-list";

type Field =
  | "manufacturerId"
  | "fiberComposition"
  | "customsDescription"
  | "hsCode"
  | "weightKg"
  | "countryOfOrigin";

const BLOCKER_FOR: Record<Field, string> = {
  manufacturerId: "manufacturer",
  fiberComposition: "fibre",
  customsDescription: "customs desc",
  hsCode: "HS code",
  weightKg: "weight",
  countryOfOrigin: "origin",
};

const BULK_FIELDS: { field: Field; label: string }[] = [
  { field: "manufacturerId", label: "Manufacturer" },
  { field: "fiberComposition", label: "Fibre composition" },
  { field: "customsDescription", label: "Customs description" },
  { field: "hsCode", label: "HS code" },
  { field: "weightKg", label: "Weight (kg)" },
  { field: "countryOfOrigin", label: "Country of origin" },
];

export function FixGrid({
  rows: initialRows,
  manufacturers,
}: {
  rows: FixRow[];
  manufacturers: { id: string; name: string; country: string | null }[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "blocked" | "warnings" | "fixable">("fixable");
  const [bulkField, setBulkField] = useState<Field>("manufacturerId");
  const [bulkValue, setBulkValue] = useState("");

  const mfrName = useMemo(
    () => new Map(manufacturers.map((m) => [m.id, m.name])),
    [manufacturers]
  );

  const visible = useMemo(() => {
    switch (filter) {
      case "blocked":
        return rows.filter((r) => r.missing.length);
      case "warnings":
        return rows.filter((r) => r.warnings.length);
      // Blocked, but not ONLY by things this screen cannot fix.
      case "fixable":
        return rows.filter(
          (r) =>
            (r.missing.length && r.missing.some((m) => !r.unfixableHere.includes(m))) ||
            r.warnings.length
        );
      default:
        return rows;
    }
  }, [rows, filter]);

  async function save(colorwayIds: string[], patch: Partial<Record<Field, string | null>>) {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/customs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds, patch }),
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

  // Apply locally so the row's blockers/warnings update without a reload.
  function applyLocal(ids: Set<string>, patch: Partial<Record<Field, string | null>>) {
    setRows((prev) =>
      prev.map((r) => {
        if (!ids.has(r.id)) return r;
        const values = { ...r.values };
        let missing = [...r.missing];
        for (const [f, v] of Object.entries(patch) as [Field, string | null][]) {
          const filled = !!(v && v.trim());
          if (f === "manufacturerId") values.manufacturerId = v;
          else if (f === "countryOfOrigin") values.countryOfOrigin = v;
          else values[f] = { value: v, fromStyle: false };
          missing = filled
            ? missing.filter((m) => m !== BLOCKER_FOR[f])
            : missing.includes(BLOCKER_FOR[f])
              ? missing
              : [...missing, BLOCKER_FOR[f]];
        }
        return { ...r, values, missing, lockedFields: [...new Set([...r.lockedFields, ...Object.keys(patch)])] };
      })
    );
  }

  async function saveCell(row: FixRow, field: Field, value: string) {
    const patch = { [field]: value } as Partial<Record<Field, string | null>>;
    if (await save([row.id], patch)) applyLocal(new Set([row.id]), patch);
  }

  async function applyBulk() {
    if (!selected.size) return toast.error("Select some products first");
    if (!bulkValue.trim()) return toast.error("Enter a value to apply");
    const label = BULK_FIELDS.find((b) => b.field === bulkField)?.label;
    if (!confirm(`Set ${label} on ${selected.size} product(s)?`)) return;
    const patch = { [bulkField]: bulkValue } as Partial<Record<Field, string | null>>;
    if (await save([...selected], patch)) {
      applyLocal(selected, patch);
      toast.success(`Updated ${selected.size} product(s)`);
      setBulkValue("");
    }
  }

  const stillBlocked = rows.filter((r) => r.missing.length).length;
  const readyNow = initialRows.length - stillBlocked;

  return (
    <div>
      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {(
          [
            ["fixable", `Fixable here (${rows.filter((r) => (r.missing.length && r.missing.some((m) => !r.unfixableHere.includes(m))) || r.warnings.length).length})`],
            ["blocked", `All blocked (${stillBlocked})`],
            ["warnings", `Suspect data (${rows.filter((r) => r.warnings.length).length})`],
            ["all", `Everything (${rows.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === key
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {label}
          </button>
        ))}
        {readyNow > 0 && (
          <span className="ml-2 text-xs text-green-700 dark:text-green-500">
            {readyNow} fixed this session
          </span>
        )}
      </div>

      {/* Bulk bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <span className="text-xs font-medium">
          {selected.size} selected
        </span>
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
        {bulkField === "manufacturerId" ? (
          <select
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            className="min-w-44 rounded border bg-background px-2 py-1 text-xs"
          >
            <option value="">— pick —</option>
            {manufacturers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.country ? ` (${m.country})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder="value"
            className="min-w-44 rounded border bg-background px-2 py-1 text-xs"
          />
        )}
        <button
          type="button"
          onClick={applyBulk}
          disabled={busy || !selected.size || !bulkValue.trim()}
          className="rounded bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-40"
        >
          Apply to selected
        </button>
        <span className="text-[11px] text-muted-foreground">
          Every edit is saved as a manual lock, so enrichment can&apos;t overwrite it.
        </span>
      </div>

      {/* Grid */}
      <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-8 p-2">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && selected.size === visible.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
                  }
                />
              </th>
              <th className="p-2">Product</th>
              <th className="w-40 p-2">Manufacturer</th>
              <th className="w-44 p-2">Fibre</th>
              <th className="w-56 p-2">Customs description</th>
              <th className="w-24 p-2">HS code</th>
              <th className="w-20 p-2">Weight</th>
              <th className="w-28 p-2">Origin</th>
              <th className="w-36 p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Row
                key={r.id}
                row={r}
                manufacturers={manufacturers}
                mfrName={mfrName}
                selected={selected.has(r.id)}
                busy={busy}
                onToggle={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                    return next;
                  })
                }
                onSave={saveCell}
              />
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nothing here — everything in this filter is resolved.
        </p>
      )}
    </div>
  );
}

function Row({
  row,
  manufacturers,
  mfrName,
  selected,
  busy,
  onToggle,
  onSave,
}: {
  row: FixRow;
  manufacturers: { id: string; name: string; country: string | null }[];
  mfrName: Map<string, string>;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onSave: (row: FixRow, field: Field, value: string) => void;
}) {
  const needs = (f: Field) => row.missing.includes(BLOCKER_FOR[f]);
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
          {row.colorwaySku} · {row.productType ?? "—"} · {row.vendor ?? "—"}
          {row.origin ? ` · ${row.origin.toLowerCase()}` : ""}
        </div>
        {row.warnings.map((w) => (
          <div key={w} className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-500">
            ⚠ {w}
          </div>
        ))}
      </td>
      <td className="p-2">
        <select
          defaultValue={row.values.manufacturerId ?? ""}
          disabled={busy}
          onChange={(e) => onSave(row, "manufacturerId", e.target.value)}
          className={cn(
            "w-full rounded border bg-background px-1.5 py-1 text-xs",
            needs("manufacturerId") && "border-rose-500/60"
          )}
        >
          <option value="">— none —</option>
          {manufacturers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </td>
      <Cell row={row} field="fiberComposition" value={row.values.fiberComposition} needs={needs("fiberComposition")} busy={busy} onSave={onSave} />
      <Cell row={row} field="customsDescription" value={row.values.customsDescription} needs={needs("customsDescription")} busy={busy} onSave={onSave} />
      <Cell row={row} field="hsCode" value={row.values.hsCode} needs={needs("hsCode")} busy={busy} onSave={onSave} />
      <Cell row={row} field="weightKg" value={row.values.weightKg} needs={needs("weightKg")} busy={busy} onSave={onSave} />
      <td className="p-2">
        <input
          defaultValue={row.values.countryOfOrigin ?? ""}
          disabled={busy}
          onBlur={(e) => {
            if (e.target.value !== (row.values.countryOfOrigin ?? "")) onSave(row, "countryOfOrigin", e.target.value);
          }}
          className={cn(
            "w-full rounded border bg-background px-1.5 py-1 text-xs",
            needs("countryOfOrigin") && "border-rose-500/60"
          )}
        />
      </td>
      <td className="p-2">
        {row.missing.length === 0 ? (
          <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:text-green-500">
            ready
          </span>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            needs {row.missing.join(", ")}
            {row.unfixableHere.length > 0 && (
              <div className="mt-0.5 text-rose-700 dark:text-rose-400">
                {row.unfixableHere.join(" + ")} — not fixable here
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function Cell({
  row,
  field,
  value,
  needs,
  busy,
  onSave,
}: {
  row: FixRow;
  field: Field;
  value: { value: string | null; fromStyle: boolean };
  needs: boolean;
  busy: boolean;
  onSave: (row: FixRow, field: Field, value: string) => void;
}) {
  return (
    <td className="p-2">
      <input
        defaultValue={value.value ?? ""}
        disabled={busy}
        onBlur={(e) => {
          if (e.target.value !== (value.value ?? "")) onSave(row, field, e.target.value);
        }}
        className={cn(
          "w-full rounded border bg-background px-1.5 py-1 text-xs",
          needs && "border-rose-500/60"
        )}
      />
      {value.value && value.fromStyle && (
        <div className="mt-0.5 text-[10px] text-muted-foreground" title="Inherited from the style; editing sets a per-colour override">
          from style
        </div>
      )}
    </td>
  );
}
