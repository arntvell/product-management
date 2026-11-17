"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Stat, StatGroup } from "@/components/ui/stat";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";
import { catalogImageSrc } from "@/lib/catalog-image";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import { BUCKET_LABELS, PLAN_LABELS, bucketFor, isOnShotList, isReadyToGoLive, type ShootBucket } from "@/lib/shoot-plan";
import type { ShootRow } from "@/lib/master/shoot";
import type { ShootStatus } from "@/generated/prisma/client";
import { MediaPanel } from "./media-panel";
import { OptionSearch } from "./references-panel";

type Tab = "new" | "carry" | "list" | "live";
type CarryFilter = "all" | "none" | "few" | "marked";
type PreparedFilter = "all" | "todo" | "done";

const TABS: { id: Tab; label: string }[] = [
  { id: "new", label: "New" },
  { id: "carry", label: "Carry-overs" },
  { id: "list", label: "Shot list" },
  { id: "live", label: "Ready to go live" },
];

/** Under this many images a carry-over is worth a look for a reshoot. */
const FEW = 3;

function imagesOf(r: ShootRow): string[] {
  return r.origo.images.length ? r.origo.images : (r.shopify?.images ?? []);
}

/** Every image Shopify holds: the gallery plus the unisex men/women lists. */
function shopifyCount(r: ShootRow) {
  return r.shopify ? r.shopify.mediaCount + r.shopify.men + r.shopify.women : 0;
}

function shopifyStatusLabel(r: ShootRow) {
  const s = r.shopify?.status;
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : "";
}

function stockLabel(r: ShootRow) {
  return r.stock == null ? "—" : String(r.stock);
}

/** "Livid Oslo 2, Livid Bergen 1" — where the stock behind the total sits. */
function locationsLabel(r: ShootRow) {
  return (r.stockDetail?.byLocation ?? []).map((l) => `${l.location} ${l.onHand}`).join(", ");
}

/** Total, with the warehouse/store split underneath. */
function StockCell({ row: r }: { row: ShootRow }) {
  if (!r.stockDetail) return <span title="Not in Loom">—</span>;
  return (
    <span className="flex flex-col items-end" title={locationsLabel(r) || "None on hand"}>
      <span>{r.stockDetail.total}</span>
      {r.stockDetail.total > 0 && (
        <span className="text-fine text-muted-foreground">
          WH {r.stockDetail.warehouse} · Stores {r.stockDetail.stores}
        </span>
      )}
    </span>
  );
}

export function ShootPlanner({
  season,
  rows: initial,
  candidates,
}: {
  season: string;
  rows: ShootRow[];
  candidates: { id: string; label: string }[];
}) {
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState<Tab>("new");
  const [lividOnly, setLividOnly] = useState(true);
  const [q, setQ] = useState("");
  const [drops, setDrops] = useState<string[]>([]);
  const [bucket, setBucket] = useState<ShootBucket | null>(null);
  const [carry, setCarry] = useState<CarryFilter>("all");
  const [preparedFilter, setPreparedFilter] = useState<PreparedFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const dropOptions = useMemo(() => [...new Set(rows.map((r) => r.drop ?? "No drop"))].sort(), [rows]);

  // Brand, drop and search apply to every tab.
  const scoped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (lividOnly && !/^livid/i.test(r.brand)) return false;
      if (drops.length && !drops.includes(r.drop ?? "No drop")) return false;
      if (!needle) return true;
      return (
        r.sku.toLowerCase().includes(needle) ||
        r.styleName.toLowerCase().includes(needle) ||
        r.colour.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle)
      );
    });
  }, [rows, lividOnly, drops, q]);

  const newRows = scoped.filter((r) => r.origin === "NEW");
  const carryRows = scoped.filter((r) => r.origin === "CARRYOVER");
  const listRows = scoped.filter((r) => r.onShotList);
  const preparedCount = listRows.filter((r) => r.prepared).length;
  // New and carry-overs alike: shot, in stock, not active on Shopify.
  const liveRows = scoped.filter(isReadyToGoLive);

  const counts = useMemo(() => {
    const c: Record<ShootBucket, number> = { shoot: 0, waiting: 0, early: 0, done: 0 };
    for (const r of newRows) c[r.bucket]++;
    return c;
  }, [newRows]);

  const shown =
    tab === "new"
      ? newRows.filter((r) => !bucket || r.bucket === bucket)
      : tab === "carry"
        ? carryRows.filter((r) => {
            const n = r.origo.count + shopifyCount(r);
            if (carry === "none") return n === 0;
            if (carry === "few") return n > 0 && Math.max(r.origo.count, shopifyCount(r)) < FEW;
            if (carry === "marked") return r.plan === "SHOOT" || r.plan === "BOOKED";
            return true;
          })
        : tab === "live"
          ? liveRows
          : listRows.filter((r) => (preparedFilter === "todo" ? !r.prepared : preparedFilter === "done" ? r.prepared : true));

  function patch(entryId: string, change: Partial<ShootRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.entryId !== entryId) return r;
        const next = { ...r, ...change };
        next.bucket = bucketFor(next.hasMedia, next.stock, next.cancelled);
        next.onShotList = isOnShotList(next.plan, next.bucket, next.kind === "added");
        return next;
      })
    );
  }

  async function save(r: ShootRow, plan: ShootStatus | null, note: string | null) {
    const before = { plan: r.plan, note: r.note };
    patch(r.entryId, { plan, note });
    try {
      const res = await fetch("/api/catalog/shoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: r.entryId, kind: r.kind, status: plan, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      patch(r.entryId, {
        planUpdatedAt: json.shootUpdatedAt,
        planUpdatedBy: json.shootUpdatedBy,
      });
    } catch (err) {
      patch(r.entryId, before);
      toast.error(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function setPrepared(r: ShootRow, prepared: boolean) {
    const before = { prepared: r.prepared, preparedAt: r.preparedAt, preparedBy: r.preparedBy };
    patch(r.entryId, { prepared });
    try {
      const res = await fetch("/api/catalog/shoot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: r.entryId, kind: r.kind, prepared }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      patch(r.entryId, { preparedAt: json.preparedAt, preparedBy: json.preparedBy });
    } catch (err) {
      patch(r.entryId, before);
      toast.error(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function remove(r: ShootRow) {
    try {
      const res = await fetch("/api/catalog/shoot/additions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.entryId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows((prev) => prev.filter((x) => x.entryId !== r.entryId));
    } catch (err) {
      toast.error(`Not removed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Rows the add call returned: replace any the board already has, append the rest. */
  function merge(added: ShootRow[]) {
    setRows((prev) => {
      const byKey = new Map(added.map((r) => [r.entryId, r]));
      const kept = prev.map((r) => byKey.get(r.entryId) ?? r);
      const seen = new Set(prev.map((r) => r.entryId));
      return [...kept, ...added.filter((r) => !seen.has(r.entryId))];
    });
  }

  function exportCsv() {
    const label = tab === "list" ? "shot-list" : tab === "new" ? "new" : tab === "live" ? "ready-to-go-live" : "carry-overs";
    downloadCsv(
      [
        "Season", "Drop", "Type", "Brand", "Style", "Colour", "SKU", "Category", "Gender",
        "Origo images", "Shopify images", "Stock", "Warehouse", "Stores", "Stock by location", "Status", "Shopify status", "Why not shot", "Plan", "Note",
        "On shot list", "Prepared", "Shopify admin",
      ],
      shown.map((r) => [
        season,
        r.drop ?? "",
        r.origin === "NEW" ? "New" : r.origin === "ADDED" ? `Added${r.fromSeason ? ` (${r.fromSeason})` : ""}` : "Carry-over",
        r.brand,
        r.styleName,
        r.colour,
        r.sku,
        r.category,
        r.gender ?? "",
        String(r.origo.count),
        r.shopify ? String(shopifyCount(r)) : "Not on Shopify",
        r.stock == null ? "" : String(r.stock),
        r.stockDetail ? String(r.stockDetail.warehouse) : "",
        r.stockDetail ? String(r.stockDetail.stores) : "",
        locationsLabel(r),
        BUCKET_LABELS[r.bucket],
        shopifyStatusLabel(r),
        r.reason ?? "",
        r.plan ? PLAN_LABELS[r.plan] : "",
        r.note ?? "",
        r.onShotList ? "Yes" : "No",
        r.prepared ? "Yes" : "No",
        r.shopify?.adminUrl ?? "",
      ]),
      `${season}-${label}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  return (
    <>
      <nav className={tabListClass} aria-label="View">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={tabItemClass(tab === t.id)}
          >
            {t.label}
            <span className="tabular-nums text-muted-foreground">
              {t.id === "new"
                ? newRows.length
                : t.id === "carry"
                  ? carryRows.length
                  : t.id === "live"
                    ? liveRows.length
                    : listRows.length}
            </span>
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLividOnly((v) => !v)}
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-3 text-meta uppercase transition-colors duration-150 ease-origo",
            lividOnly ? "border-ink bg-ink text-offwhite" : "border-line bg-paper text-ink hover:border-ink"
          )}
        >
          Livid only
        </button>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search style, colour, SKU, category…"
          className="h-8 w-72"
        />
        <MultiSelect options={dropOptions} selected={drops} onChange={setDrops} placeholder="All drops" className="h-8" />
        {tab === "carry" && (
          <div className="flex gap-1">
            {(
              [
                ["all", "All"],
                ["none", "No images"],
                ["few", `Under ${FEW} images`],
                ["marked", "Marked to shoot"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCarry(id)}
                className={cn(
                  "h-8 border px-2.5 text-fine",
                  carry === id ? "border-ink bg-ink text-offwhite" : "border-line text-muted-foreground hover:bg-hover"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {tab === "list" && (
          <div className="flex gap-1">
            {(
              [
                ["all", "All"],
                ["todo", `To prepare ${listRows.length - preparedCount}`],
                ["done", `Prepared ${preparedCount}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPreparedFilter(id)}
                className={cn(
                  "h-8 border px-2.5 text-fine tabular-nums",
                  preparedFilter === id ? "border-ink bg-ink text-offwhite" : "border-line text-muted-foreground hover:bg-hover"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto">
          <Button size="sm" onClick={exportCsv} disabled={!shown.length}>
            Export CSV
          </Button>
        </div>
      </div>

      {tab === "list" && (
        <AddToList
          season={season}
          candidates={candidates}
          listed={listRows.map((r) => r.colorwayId)}
          onAdded={merge}
        />
      )}

      {tab === "new" && (
        <StatGroup>
          {(Object.keys(BUCKET_LABELS) as ShootBucket[]).map((b) => (
            <Stat
              key={b}
              label={BUCKET_LABELS[b] + (bucket === b ? " · shown" : "")}
              value={counts[b]}
              note={
                b === "shoot"
                  ? "No images, in stock"
                  : b === "waiting"
                    ? "No images, no stock"
                    : b === "early"
                      ? "Has images, no stock yet"
                      : "Has images and stock"
              }
              onClick={() => setBucket(bucket === b ? null : b)}
            />
          ))}
        </StatGroup>
      )}

      {tab === "carry" ? (
        <div className="grid grid-cols-1 gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => (
            <CarryCard key={r.entryId} row={r} onOpen={() => setOpenId(r.colorwayId)} actions={{ save, setPrepared, remove }} />
          ))}
          {!shown.length && <Empty />}
        </div>
      ) : (
        <div className="overflow-x-auto border border-line bg-paper">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line text-left text-meta uppercase text-muted-foreground">
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Drop</th>
                <th className="px-3 py-2 text-right">Images</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Plan · note</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <TableRow key={r.entryId} row={r} onOpen={() => setOpenId(r.colorwayId)} actions={{ save, setPrepared, remove }} />
              ))}
            </tbody>
          </table>
          {!shown.length && <Empty />}
        </div>
      )}

      <MediaPanel
        colorwayId={openId}
        onClose={() => setOpenId(null)}
        onChanged={(id, items) =>
          setRows((prev) =>
            prev.map((r) => {
              if (r.colorwayId !== id) return r;
              const origo = {
                count: items.length,
                images: items.slice(0, 6).map((i) => i.url),
                men: items.filter((i) => i.role === "MEN").length,
                women: items.filter((i) => i.role === "WOMEN").length,
              };
              const hasMedia = origo.count > 0 || shopifyCount(r) > 0;
              const bucket = bucketFor(hasMedia, r.stock, r.cancelled);
              return { ...r, origo, hasMedia, bucket, onShotList: isOnShotList(r.plan, bucket, r.kind === "added") };
            })
          )
        }
      />
    </>
  );
}

function Empty() {
  return <div className="bg-paper px-4 py-10 text-center text-body text-muted-foreground">Nothing here.</div>;
}

interface RowActions {
  save: (r: ShootRow, plan: ShootStatus | null, note: string | null) => void;
  setPrepared: (r: ShootRow, prepared: boolean) => void;
  remove: (r: ShootRow) => void;
}

/** Add products to the shot list: from this season, or any other. */
function AddToList({
  season,
  candidates,
  listed,
  onAdded,
}: {
  season: string;
  candidates: { id: string; label: string }[];
  listed: string[];
  onAdded: (rows: ShootRow[]) => void;
}) {
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(body: { ids?: string[]; skus?: string[] }) {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/shoot/additions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not add");
      onAdded(json.rows);
      const parts = [`Added ${json.added}.`];
      if (json.already) parts.push(`${json.already} already on the list.`);
      if (json.notFound?.length) parts.push(`Not found: ${json.notFound.join(", ")}.`);
      (json.notFound?.length ? toast.warning : toast.success)(parts.join(" "));
      setPaste(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body">Add to the shot list</span>
        <OptionSearch
          className="w-80"
          options={candidates}
          exclude={listed}
          placeholder="Search Livid products"
          onPick={(o) => void add({ ids: [o.id] })}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPaste(paste === null ? "" : null)}>
          Paste SKUs
        </Button>
      </div>
      {paste !== null && (
        <div className="flex flex-wrap items-end gap-2">
          <textarea
            className="h-24 w-96 max-w-full border bg-background p-2 font-mono text-fine"
            placeholder="Colourway SKUs, one per line or separated by commas"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !paste.trim()}
            onClick={() => void add({ skus: paste.split(/[\s,;]+/).filter(Boolean) })}
          >
            {busy ? "Adding…" : "Add SKUs"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Thumb({ url, size }: { url: string | undefined; size: "sm" | "lg" }) {
  const cls = size === "sm" ? "size-11" : "aspect-[3/4] w-full";
  if (!url) return <div className={cn(cls, "flex items-center justify-center bg-hover text-fine text-muted-foreground")}>—</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={catalogImageSrc(url) ?? ""} alt="" loading="lazy" className={cn(cls, "object-cover")} />;
}

function PlanControls({ row, actions }: { row: ShootRow; actions: RowActions }) {
  const [note, setNote] = useState(row.note ?? "");
  const onSave = actions.save;
  return (
    <div className="flex flex-col gap-1.5">
      {row.onShotList && (
        <label
          className="flex h-8 cursor-pointer items-center gap-2 text-fine"
          title={row.prepared && row.preparedBy ? `Prepared by ${row.preparedBy}` : undefined}
        >
          <Checkbox checked={row.prepared} onCheckedChange={(v) => actions.setPrepared(row, v === true)} />
          <span className={cn(!row.prepared && "text-muted-foreground")}>Prepared</span>
        </label>
      )}
      <select
        value={row.plan ?? ""}
        onChange={(e) => onSave(row, (e.target.value || null) as ShootStatus | null, row.note)}
        className="h-8 border border-line bg-paper px-2 text-fine"
        aria-label="Plan"
      >
        <option value="">{row.kind === "added" ? "Added · on list" : row.onShotList && !row.plan ? "Auto · on list" : "Auto"}</option>
        {(Object.keys(PLAN_LABELS) as ShootStatus[]).map((s) => (
          <option key={s} value={s}>
            {PLAN_LABELS[s]}
          </option>
        ))}
      </select>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if ((row.note ?? "") !== note) onSave(row, row.plan, note || null);
        }}
        placeholder="Note"
        className="h-8 text-fine"
      />
      {row.kind === "added" && (
        <Button size="sm" variant="outline" onClick={() => actions.remove(row)}>
          Remove from list
        </Button>
      )}
    </div>
  );
}

function StatusCell({ row }: { row: ShootRow }) {
  return (
    <div className="flex flex-col">
      <span className={cn(row.bucket === "shoot" && "text-ink underline decoration-1 underline-offset-[3px]")}>
        {BUCKET_LABELS[row.bucket]}
      </span>
      {row.reason && <span className="text-fine text-muted-foreground">{row.reason}</span>}
      {!row.shopify && <span className="text-fine text-muted-foreground">Not on Shopify</span>}
      {row.shopify?.status && row.shopify.status !== "ACTIVE" && (
        <span className="text-fine text-muted-foreground">Shopify: {shopifyStatusLabel(row)}</span>
      )}
      {row.drop === "UNCERTAIN" && <span className="text-fine text-muted-foreground">Drop uncertain</span>}
    </div>
  );
}

function TableRow({ row: r, onOpen, actions }: { row: ShootRow; onOpen: () => void; actions: RowActions }) {
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <td className="px-3 py-2">
        <button type="button" onClick={onOpen} className="flex items-center gap-3 text-left hover:underline">
          <Thumb url={imagesOf(r)[0]} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">
              {r.styleName} · {r.colour}
            </span>
            <span className="truncate text-fine text-muted-foreground">
              <span className="font-mono">{r.sku}</span> · {r.category}
              {r.origin === "CARRYOVER" ? " · carry-over" : ""}
              {r.origin === "ADDED" ? ` · added${r.fromSeason ? ` from ${r.fromSeason}` : ""}` : ""}
              {r.brand && !/^livid/i.test(r.brand) ? ` · ${r.brand}` : ""}
            </span>
          </span>
        </button>
      </td>
      <td className="px-3 py-2 text-fine">{r.drop ?? "—"}</td>
      <td className="px-3 py-2 text-right text-fine tabular-nums">
        <MediaCounts row={r} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <StockCell row={r} />
      </td>
      <td className="px-3 py-2">
        <StatusCell row={r} />
      </td>
      <td className="w-52 px-3 py-2">
        <PlanControls key={r.note ?? ""} row={r} actions={actions} />
      </td>
    </tr>
  );
}

function MediaCounts({ row: r }: { row: ShootRow }) {
  return (
    <span className="flex flex-col items-end">
      <span>Origo {r.origo.count}</span>
      <span className="text-muted-foreground">
        {r.shopify ? (
          r.shopify.adminUrl ? (
            <a href={r.shopify.adminUrl} target="_blank" rel="noreferrer" className="text-muted-foreground">
              Shopify {shopifyCount(r)}
            </a>
          ) : (
            `Shopify ${shopifyCount(r)}`
          )
        ) : (
          "Not on Shopify"
        )}
      </span>
      {r.shopify && (r.shopify.men > 0 || r.shopify.women > 0) && (
        <span className="text-muted-foreground">
          Men {r.shopify.men} / Women {r.shopify.women}
        </span>
      )}
    </span>
  );
}

function CarryCard({ row: r, onOpen, actions }: { row: ShootRow; onOpen: () => void; actions: RowActions }) {
  const images = imagesOf(r).slice(0, 4);
  return (
    <div className="flex flex-col gap-3 bg-paper p-4">
      <button type="button" onClick={onOpen} className="grid grid-cols-4 gap-1" aria-label="Open media">
        {images.length ? images.map((u) => <Thumb key={u} url={u} size="lg" />) : <Thumb url={undefined} size="lg" />}
      </button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate">
            {r.styleName} · {r.colour}
          </div>
          <div className="truncate text-fine text-muted-foreground">
            <span className="font-mono">{r.sku}</span> · {r.category}
            {r.drop ? ` · ${r.drop}` : ""}
          </div>
          <div className="text-fine text-muted-foreground">
            <span title={locationsLabel(r) || undefined}>
              Stock {stockLabel(r)}
              {r.stockDetail && r.stockDetail.total > 0
                ? ` (WH ${r.stockDetail.warehouse} · Stores ${r.stockDetail.stores})`
                : ""}
            </span>
            {r.origo.men || r.origo.women ? ` · Men ${r.origo.men} / Women ${r.origo.women}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right text-fine tabular-nums">
          <MediaCounts row={r} />
        </div>
      </div>
      <PlanControls key={r.note ?? ""} row={r} actions={actions} />
    </div>
  );
}
