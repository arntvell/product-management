"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { catalogImageSrc } from "@/lib/catalog-image";
import { cn } from "@/lib/utils";
import type { PublishingRow, ChannelCellState } from "@/lib/master/queries";

interface PushReport {
  channel: "Shopify" | "Loom";
  ok: number;
  total: number;
  issues: string[]; // failures, warnings, and skips — one line each
}

export function PublishingTable({
  rows,
  season,
}: {
  rows: PublishingRow[];
  season?: string;
}) {
  const [items, setItems] = useState<PublishingRow[]>(rows);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [droppedFilter, setDroppedFilter] = useState<"all" | "active" | "dropped">("all");
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushingLoom, setPushingLoom] = useState(false);
  const [report, setReport] = useState<PushReport | null>(null);

  // Map a colorway id to its readable name for the report.
  const nameOf = (id: string) => {
    const r = items.find((x) => x.id === id);
    return r ? `${r.styleName} / ${r.name}` : id;
  };

  async function pushLoomSelected() {
    if (selected.size === 0) return;
    if (!season) {
      toast.error("Pick a season first — Loom pushes are per-season.");
      return;
    }
    if (!confirm(`Push ${selected.size} product(s) to Loom for ${season}? Not-ready products are skipped.`)) return;
    setPushingLoom(true);
    setReport(null);
    const ids = [...selected];
    try {
      const res = await fetch("/api/catalog/push/loom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids, seasonCode: season }),
      });
      const data = await res.json();
      if (!res.ok && data.sent === undefined)
        throw new Error(data.error ?? data.raw ?? "Loom push failed");

      const skipped: { colorwayId: string; reason: string }[] = data.skipped ?? [];
      const skippedIds = new Set(skipped.map((s) => s.colorwayId));
      // Mark published ONLY for the products actually sent (not skipped).
      if (data.ok) {
        setItems((prev) =>
          prev.map((r) =>
            selected.has(r.id) && !skippedIds.has(r.id)
              ? { ...r, loom: { ...r.loom, targeted: true, published: true } }
              : r
          )
        );
      }
      setReport({
        channel: "Loom",
        ok: data.sent ?? 0,
        total: data.requested ?? ids.length,
        issues: skipped.map((s) => `${nameOf(s.colorwayId)} — skipped: ${s.reason}`),
      });
      if (data.ok) toast.success(`Pushed ${data.sent} to Loom (${season})${skipped.length ? `, ${skipped.length} skipped` : ""}`);
      else toast.error(`Loom push failed — ${data.sent ?? 0} sent, ${skipped.length} skipped`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Loom push failed");
    } finally {
      setPushingLoom(false);
    }
  }

  async function pushSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Push ${selected.size} product(s) to Shopify now? Creates/updates the live Shopify products. Not-ready products are skipped.`))
      return;
    setPushing(true);
    setReport(null);
    const ids = [...selected];
    try {
      const res = await fetch("/api/catalog/push/shopify/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: ids, seasonCode: season }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bulk push failed");
      const results = data.results as {
        colorwayId: string;
        ok: boolean;
        error?: string;
        warnings?: string[];
      }[];
      const okIds = new Set(results.filter((r) => r.ok).map((r) => r.colorwayId));
      setItems((prev) =>
        prev.map((r) =>
          okIds.has(r.id)
            ? { ...r, shopify: { ...r.shopify, targeted: true, published: true } }
            : r
        )
      );
      const issues = [
        ...results.filter((r) => !r.ok).map((r) => `${nameOf(r.colorwayId)} — failed: ${r.error ?? "unknown"}`),
        ...results
          .filter((r) => r.ok && r.warnings?.length)
          .flatMap((r) => r.warnings!.map((w) => `${nameOf(r.colorwayId)} — ${w}`)),
      ];
      setReport({ channel: "Shopify", ok: data.ok, total: data.total, issues });
      if (data.failed > 0) toast.error(`Pushed ${data.ok}/${data.total} to Shopify — ${data.failed} failed`);
      else if (issues.length) toast.warning(`Pushed ${data.ok} to Shopify with ${issues.length} warning(s)`);
      else toast.success(`Pushed ${data.ok} product(s) to Shopify`);
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
          <Button
            size="sm"
            disabled={pushingLoom || !selected.size}
            onClick={pushLoomSelected}
            title={season ? `Push to Loom for ${season}` : "Select a season to push to Loom"}
          >
            {pushingLoom ? "Pushing…" : `Push ${selected.size || ""} to Loom`.replace("  ", " ")}
          </Button>
        </div>
      </div>

      {report && (
        <div className="mt-3 rounded-lg border bg-muted/20 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {report.channel} push: {report.ok}/{report.total} pushed
              {report.issues.length ? ` · ${report.issues.length} issue(s)` : " · no issues"}
            </span>
            <button
              onClick={() => setReport(null)}
              className="text-muted-foreground underline underline-offset-4"
            >
              Dismiss
            </button>
          </div>
          {report.issues.length > 0 && (
            <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-auto pl-4 text-amber-700 dark:text-amber-500">
              {report.issues.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      )}

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
