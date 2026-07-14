"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { catalogImageSrc } from "@/lib/catalog-image";
import { cn } from "@/lib/utils";
import type { PublishingRow, ChannelCellState } from "@/lib/master/queries";

export function PublishingTable({ rows }: { rows: PublishingRow[] }) {
  const [items, setItems] = useState<PublishingRow[]>(rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [droppedFilter, setDroppedFilter] = useState<"all" | "active" | "dropped">("all");
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);

  async function pushSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Push ${selected.size} product(s) to Shopify now? Creates/updates the live Shopify products.`))
      return;
    setPushing(true);
    const ids = [...selected];
    try {
      const res = await fetch("/api/catalog/push/shopify/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bulk push failed");
      const okIds = new Set(
        (data.results as { colorwayId: string; ok: boolean }[])
          .filter((r) => r.ok)
          .map((r) => r.colorwayId)
      );
      setItems((prev) =>
        prev.map((r) =>
          okIds.has(r.id)
            ? { ...r, shopify: { ...r.shopify, targeted: true, published: true } }
            : r
        )
      );
      if (data.failed > 0) {
        const firstErr = (data.results as { ok: boolean; error?: string }[]).find((r) => !r.ok)?.error;
        toast.error(`Pushed ${data.ok}/${data.total}. ${data.failed} failed — e.g. ${firstErr ?? ""}`);
      } else {
        toast.success(`Pushed ${data.ok} product(s) to Shopify`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk push failed");
    } finally {
      setPushing(false);
    }
  }

  const visible = items.filter((r) =>
    droppedFilter === "active" ? !r.dropped : droppedFilter === "dropped" ? r.dropped : true
  );
  const droppedCount = items.filter((r) => r.dropped).length;
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((i) => i.id)));
  }
  function selectReady(channel: "shopify" | "loom") {
    setSelected(new Set(visible.filter((i) => i[channel].ready).map((i) => i.id)));
  }

  async function bulk(channel: "SHOPIFY" | "LOOM", action: "target" | "untarget") {
    if (selected.size === 0) return;
    setBusy(true);
    const ids = [...selected];
    try {
      const res = await fetch("/api/catalog/channels/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids, channel, action }),
      });
      if (!res.ok) throw new Error("Failed");
      const key = channel === "SHOPIFY" ? "shopify" : "loom";
      setItems((prev) =>
        prev.map((r) =>
          selected.has(r.id)
            ? { ...r, [key]: { ...r[key], targeted: action === "target" } }
            : r
        )
      );
      toast.success(
        `${action === "target" ? "Targeted" : "Untargeted"} ${ids.length} → ${channel === "SHOPIFY" ? "Shopify" : "Loom"}`
      );
    } catch {
      toast.error("Bulk update failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleOne(row: PublishingRow, channel: "SHOPIFY" | "LOOM") {
    const key = channel === "SHOPIFY" ? "shopify" : "loom";
    const action = row[key].targeted ? "untarget" : "target";
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/channels/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: [row.id], channel, action }),
      });
      if (!res.ok) throw new Error();
      setItems((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, [key]: { ...r[key], targeted: action === "target" } } : r
        )
      );
    } catch {
      toast.error("Couldn't update channel");
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    shopify: items.filter((r) => r.shopify.targeted).length,
    loom: items.filter((r) => r.loom.targeted).length,
    shopifyReady: items.filter((r) => r.shopify.ready).length,
    loomReady: items.filter((r) => r.loom.ready).length,
  };

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        {items.length} products · {counts.shopify} → Shopify · {counts.loom} → Loom ·{" "}
        {counts.shopifyReady} Shopify-ready · {counts.loomReady} Loom-ready.
      </p>

      <div className="mt-3 flex gap-1" title="Filter by Threadflow dropped status">
        {(["all", "active", "dropped"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setDroppedFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
              droppedFilter === f
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {f === "dropped" ? `Dropped (${droppedCount})` : f}
          </button>
        ))}
      </div>

      {/* Bulk toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {selected.size} selected
        </span>
        <div className="h-4 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => selectReady("shopify")}>
          Select Shopify-ready
        </Button>
        <Button size="sm" variant="ghost" onClick={() => selectReady("loom")}>
          Select Loom-ready
        </Button>
        {selected.size > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => bulk("SHOPIFY", "target")}>
            Target Shopify
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !selected.size} onClick={() => bulk("LOOM", "target")}>
            Target Loom
          </Button>
          <Button size="sm" variant="ghost" disabled={busy || !selected.size} onClick={() => bulk("SHOPIFY", "untarget")} className="text-muted-foreground">
            Untarget Shopify
          </Button>
          <Button size="sm" variant="ghost" disabled={busy || !selected.size} onClick={() => bulk("LOOM", "untarget")} className="text-muted-foreground">
            Untarget Loom
          </Button>
          <div className="mx-1 w-px self-stretch bg-border" />
          <Button size="sm" disabled={pushing || !selected.size} onClick={pushSelected}>
            {pushing ? "Pushing…" : `Push ${selected.size || ""} to Shopify`.replace("  ", " ")}
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3">
                <input type="checkbox" checked={allSelected} onChange={selectAll} />
              </th>
              <th className="w-12 p-3"></th>
              <th className="p-3">Product</th>
              <th className="w-40 p-3 text-center">Shopify</th>
              <th className="w-40 p-3 text-center">Loom</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const src = catalogImageSrc(r.thumbnailRef);
              return (
                <tr key={r.id} className={cn("border-b last:border-0 hover:bg-muted/20", selected.has(r.id) && "bg-muted/30")}>
                  <td className="p-3">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td className="p-2">
                    <div className="h-9 w-9 overflow-hidden rounded bg-muted">
                      {src && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <a href={`/catalog/colorways/${r.id}`} className="font-medium hover:underline">
                      {r.dropped && (
                        <span
                          title="Dropped from Threadflow for this season"
                          className="mr-1.5 rounded bg-amber-500/20 px-1 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-500"
                        >
                          dropped
                        </span>
                      )}
                      {r.name}
                    </a>
                    <div className="text-xs text-muted-foreground">{r.styleName}</div>
                  </td>
                  <ChannelCell state={r.shopify} busy={busy} onToggle={() => toggleOne(r, "SHOPIFY")} />
                  <ChannelCell state={r.loom} busy={busy} onToggle={() => toggleOne(r, "LOOM")} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ChannelCell({
  state,
  busy,
  onToggle,
}: {
  state: ChannelCellState;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <td className="p-3 text-center">
      <div className="flex flex-col items-center gap-1">
        <input type="checkbox" checked={state.targeted} disabled={busy} onChange={onToggle} />
        {state.ready ? (
          <span className="rounded-full px-1.5 text-[10px] text-green-700 dark:text-green-500">
            {state.published ? "published" : state.targeted ? "targeted" : "ready"}
          </span>
        ) : (
          <span
            className="rounded-full px-1.5 text-[10px] text-amber-600 dark:text-amber-500"
            title={`Missing: ${state.missing.join(", ")}`}
          >
            needs {state.missing.length}
          </span>
        )}
      </div>
    </td>
  );
}
