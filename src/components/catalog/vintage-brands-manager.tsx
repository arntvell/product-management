"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VBrand {
  id: string;
  name: string;
  archived: boolean;
  garments: number;
}

const INPUT =
  "border bg-background px-2 py-1 text-body outline-none focus:ring-1 focus:ring-ring";
const BTN = "border px-2.5 py-1 text-fine transition-colors hover:bg-muted disabled:opacity-40";

/** Add, rename and archive the makers the vintage drop sheet offers. */
export function VintageBrandsManager() {
  const [brands, setBrands] = useState<VBrand[] | null>(null);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/vintage/brands");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error ?? "Could not load the brands");
    setBrands(data.brands);
  }, []);

  useEffect(() => {
    // Fetch-on-mount: the list is small and changes from this screen only.
    void load();
  }, [load]);

  async function send(url: string, method: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success(data.restored ? `${data.brand.name} was archived — brought it back.` : ok);
      await load();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const name = newName.trim();
    if (!name) return;
    if (await send("/api/vintage/brands", "POST", { name }, `${name} added.`)) setNewName("");
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (brands ?? []).filter(
      (b) => b.archived === showArchived && (!needle || b.name.toLowerCase().includes(needle))
    );
  }, [brands, q, showArchived]);

  // A typo is usually the brand next to it, spelled differently.
  const lookalike = useMemo(() => {
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const seen = new Map<string, string[]>();
    for (const b of brands ?? []) {
      if (b.archived) continue;
      const k = key(b.name);
      seen.set(k, [...(seen.get(k) ?? []), b.name]);
    }
    return new Set([...seen.values()].filter((v) => v.length > 1).flat());
  }, [brands]);

  const archivedCount = (brands ?? []).filter((b) => b.archived).length;

  return (
    <div className="mt-6 max-w-3xl space-y-4">
      <form
        className="flex flex-wrap items-center gap-2 border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className={cn(INPUT, "min-w-[16rem] flex-1")}
          placeholder="New brand, spelled as on the label — e.g. Stone Island"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={busy || !newName.trim()} className={BTN}>
          Add brand
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <input
          className={cn(INPUT, "max-w-xs")}
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-body">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Archived ({archivedCount})
        </label>
        <span className="ml-auto text-fine text-muted-foreground">{rows.length} shown</span>
      </div>

      {brands === null ? (
        <p className="text-body text-muted-foreground">Loading…</p>
      ) : (
        <div className="divide-y border">
          {rows.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-body">
              {editing?.id === b.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await send(`/api/vintage/brands/${b.id}`, "PATCH", { name: editing.name }, "Renamed."))
                      setEditing(null);
                  }}
                >
                  <input
                    autoFocus
                    className={cn(INPUT, "flex-1")}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: b.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                  />
                  <button type="submit" disabled={busy} className={BTN}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className={BTN}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">
                    {b.name}
                    {lookalike.has(b.name) ? (
                      <span className="ml-2 text-fine text-ink">same as another spelling?</span>
                    ) : null}
                  </span>
                  <span className="text-fine text-muted-foreground">
                    {b.garments ? `${b.garments} garment${b.garments === 1 ? "" : "s"}` : "unused"}
                  </span>
                  <button type="button" disabled={busy} onClick={() => setEditing({ id: b.id, name: b.name })} className={BTN}>
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      send(
                        `/api/vintage/brands/${b.id}`,
                        "PATCH",
                        { archived: !b.archived },
                        b.archived ? `${b.name} is back on the list.` : `${b.name} archived.`
                      )
                    }
                    className={BTN}
                  >
                    {b.archived ? "Restore" : "Archive"}
                  </button>
                </>
              )}
            </div>
          ))}
          {rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-body text-muted-foreground">
              {showArchived ? "Nothing archived." : "No brands match."}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
