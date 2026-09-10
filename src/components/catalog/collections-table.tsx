"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { catalogImageSrc } from "@/lib/catalog-image";
import { cn } from "@/lib/utils";
import type { CollectionMember } from "@/lib/master/collections";

// The Collections list.
//
// Carrying a product into a season used to be a per-row button, always armed,
// writing immediately to whatever season a page-level selector was set to. That
// combination made a misclick both easy and invisible — and because Price is a
// separate per-season row, the carried product silently had no price for its
// new season and only failed later, at push. So the write is now: select rows,
// choose the season in the action bar, read what will happen, confirm.
//
// The CORE toggle stays inline: it is idempotent, reversible and visible.

interface CarryPreview {
  seasonCode: string;
  requested: number;
  alreadyIn: number;
  wouldAdd: number;
  wouldLackPrice: number;
  pricedElsewhere: number;
  unpricedSample: { id: string; colorwaySku: string; name: string }[];
}

export function CollectionsTable({
  members,
  filteredCount,
  bucketLabel,
  carrySeasons,
  initialSeason,
}: {
  members: CollectionMember[];
  filteredCount: number;
  bucketLabel: string;
  carrySeasons: string[];
  initialSeason: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [tag, setTag] = useState("");
  const [needs, setNeeds] = useState<"" | "unpriced" | "sale" | "core" | "carryover">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [season, setSeason] = useState(initialSeason);
  const [preview, setPreview] = useState<CarryPreview | null>(null);
  const [pendingRemove, setPendingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [core, setCore] = useState<Record<string, boolean>>({});

  const options = useMemo(() => {
    const uniq = (vals: (string | null)[]) =>
      [...new Set(vals.filter((v): v is string => !!v && !!v.trim()))].sort();
    return {
      vendors: uniq(members.map((m) => m.vendor)),
      types: uniq(members.map((m) => m.productType)),
      tags: uniq(members.flatMap((m) => m.tags)).slice(0, 200),
    };
  }, [members]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (q) {
        const hay = `${m.name} ${m.styleName} ${m.colorwaySku} ${m.vendor ?? ""} ${
          m.productType ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (vendor && m.vendor !== vendor) return false;
      if (productType && m.productType !== productType) return false;
      if (tag && !m.tags.includes(tag)) return false;
      if (needs === "unpriced" && (m.origin === null || m.hasTargetPrice)) return false;
      if (needs === "sale" && !m.onSale) return false;
      if (needs === "core" && !isCore(m)) return false;
      if (needs === "carryover" && m.origin !== "CARRYOVER") return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, search, vendor, productType, tag, needs, core]);

  function isCore(m: CollectionMember): boolean {
    return core[m.id] ?? m.isCore;
  }

  // The full result set is rendered, however large — a cap here once hid
  // products from the one list that answers "where does this product live?".
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 63,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
    ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const selectedIds = [...selected];

  // Products in the list that are in the target season with no price for it —
  // the state that passes every screen and then fails at push.
  const unpricedInSeason = rows.filter((m) => m.origin !== null && !m.hasTargetPrice).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleCore(m: CollectionMember) {
    const next = !isCore(m);
    setCore((c) => ({ ...c, [m.id]: next }));
    try {
      const res = await fetch(`/api/catalog/colorways/${m.id}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCore: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success(next ? "Marked as Core" : "Removed from Core");
    } catch (e) {
      setCore((c) => ({ ...c, [m.id]: !next }));
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function openPreview(remove: boolean) {
    if (!selectedIds.length) return;
    setBusy(true);
    setPendingRemove(remove);
    try {
      const res = await fetch("/api/catalog/carry-over", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayIds: selectedIds, seasonCode: season, dryRun: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Preview failed");
      setPreview(d as CarryPreview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/carry-over", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colorwayIds: selectedIds,
          seasonCode: season,
          ...(pendingRemove ? { remove: true } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      toast.success(
        pendingRemove
          ? `Removed ${d.removed} product(s) from ${season}`
          : `Carried ${d.added} product(s) into ${season}` +
              (d.wouldLackPrice ? ` — ${d.wouldLackPrice} still need a ${season} price` : "")
      );
      setPreview(null);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const selectCls =
    "h-8 rounded-md border bg-background px-2 text-xs text-foreground shadow-sm";

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, style, SKU, vendor…"
          className="h-8 w-72 text-xs"
        />
        <select className={selectCls} value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">All vendors</option>
          {options.vendors.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select
          className={selectCls}
          value={productType}
          onChange={(e) => setProductType(e.target.value)}
        >
          <option value="">All types</option>
          {options.types.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select className={selectCls} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {options.tags.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <select
          className={selectCls}
          value={needs}
          onChange={(e) => setNeeds(e.target.value as typeof needs)}
        >
          <option value="">Everything</option>
          <option value="unpriced">No price for {initialSeason}</option>
          <option value="carryover">Carry-overs</option>
          <option value="core">Core</option>
          <option value="sale">On sale</option>
        </select>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {rows.length} of {filteredCount} · {bucketLabel}
        </span>
      </div>

      {unpricedInSeason > 0 && needs !== "unpriced" && (
        <button
          type="button"
          onClick={() => setNeeds("unpriced")}
          className="mt-2 w-fit rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-500"
        >
          {unpricedInSeason} product{unpricedInSeason !== 1 ? "s are" : " is"} in {initialSeason}{" "}
          with no {initialSeason} price — they will fail at push. Show them →
        </button>
      )}

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium tabular-nums">{selected.size} selected</span>
          <select
            className={selectCls}
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            {carrySeasons.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => openPreview(false)}>
            Carry into {season}…
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => openPreview(true)}
          >
            Remove from {season}…
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3">
                <Checkbox
                  checked={allShown}
                  onCheckedChange={() =>
                    setSelected(allShown ? new Set() : new Set(rows.map((r) => r.id)))
                  }
                  aria-label="Select all shown"
                />
              </th>
              <th className="w-14 p-3" />
              <th className="p-3">Product</th>
              <th className="p-3">SKU</th>
              <th className="p-3">Vendor</th>
              <th className="p-3">Type</th>
              <th className="w-52 p-3">Line</th>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td colSpan={7} style={{ height: paddingTop }} />
              </tr>
            )}
            {virtualRows.map((vr) => {
              const m = rows[vr.index];
              const src = catalogImageSrc(m.thumbnailRef);
              const inSeason = m.origin !== null;
              const needsPrice = inSeason && !m.hasTargetPrice;
              return (
                <tr
                  key={m.id}
                  data-index={vr.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/30",
                    selected.has(m.id) && "bg-primary/5"
                  )}
                >
                  <td className="p-3">
                    <Checkbox
                      checked={selected.has(m.id)}
                      onCheckedChange={() => toggle(m.id)}
                      aria-label={`Select ${m.name}`}
                    />
                  </td>
                  <td className="p-2">
                    <div className="h-11 w-11 overflow-hidden rounded bg-muted">
                      {src && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <Link href={`/catalog/colorways/${m.id}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{m.styleName}</div>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{m.colorwaySku}</td>
                  <td className="p-3 text-muted-foreground">{m.vendor ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{m.productType ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleCore(m)}
                        title={isCore(m) ? "Core line — click to unset" : "Mark as Core line"}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors",
                          isCore(m)
                            ? "bg-foreground text-background"
                            : "border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        ★ Core
                      </button>
                      {inSeason && (
                        <span
                          title={`In ${m.targetSeason}`}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            m.origin === "CARRYOVER"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-500"
                              : "bg-green-500/15 text-green-700 dark:text-green-500"
                          )}
                        >
                          {m.origin === "CARRYOVER" ? "Carry-over" : "New"}
                        </span>
                      )}
                      {needsPrice && (
                        <span
                          title={
                            m.pricedElsewhere
                              ? `No ${m.targetSeason} price — priced in another season, so carry-forward can fill it`
                              : `No ${m.targetSeason} price, and not priced in any season`
                          }
                          className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-400"
                        >
                          No price
                        </span>
                      )}
                      {m.onSale && (
                        <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700/80 dark:text-rose-400/80">
                          Sale
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td colSpan={7} style={{ height: paddingBottom }} />
              </tr>
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingRemove
                ? `Remove ${selected.size} product(s) from ${season}?`
                : `Carry ${selected.size} product(s) into ${season}?`}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                {pendingRemove ? (
                  <p>
                    They leave {season} entirely — the season entry is deleted, so they fall out
                    of that season&apos;s push scope. Prices and everything else are untouched.
                  </p>
                ) : preview ? (
                  <>
                    <ul className="space-y-1">
                      <li>
                        <b className="tabular-nums">{preview.wouldAdd}</b> will be added as
                        carry-over.
                      </li>
                      {preview.alreadyIn > 0 && (
                        <li className="text-muted-foreground">
                          {preview.alreadyIn} already in {season} — unchanged.
                        </li>
                      )}
                    </ul>
                    {preview.wouldLackPrice > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-400">
                        <b className="tabular-nums">{preview.wouldLackPrice}</b> will have no{" "}
                        {season} price and cannot be pushed until priced.
                        {preview.pricedElsewhere > 0 && (
                          <>
                            {" "}
                            {preview.pricedElsewhere} of those are priced in another season, so
                            carry-forward can fill them.
                          </>
                        )}
                        {preview.unpricedSample.length > 0 && (
                          <div className="mt-1 font-mono text-[11px] opacity-80">
                            {preview.unpricedSample.map((u) => u.colorwaySku).join(", ")}
                            {preview.wouldLackPrice > preview.unpricedSample.length && " …"}
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Prices are not copied — carry-overs are repriced per season.
                    </p>
                  </>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {pendingRemove ? "Remove" : "Carry over"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
