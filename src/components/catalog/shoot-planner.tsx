"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Stat, StatGroup } from "@/components/ui/stat";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";
import { catalogImageSrc } from "@/lib/catalog-image";
import { downloadCsv } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import { BUCKET_LABELS, PLAN_LABELS, bucketFor, isOnShotList, type ShootBucket } from "@/lib/shoot-plan";
import type { ShootRow } from "@/lib/master/shoot";
import type { ShootStatus } from "@/generated/prisma/client";
import { MediaPanel } from "./media-panel";

type Tab = "new" | "carry" | "list";
type CarryFilter = "all" | "none" | "few" | "marked";

const TABS: { id: Tab; label: string }[] = [
  { id: "new", label: "New" },
  { id: "carry", label: "Carry-overs" },
  { id: "list", label: "Shot list" },
];

/** Under this many images a carry-over is worth a look for a reshoot. */
const FEW = 3;

function imagesOf(r: ShootRow): string[] {
  return r.origo.images.length ? r.origo.images : (r.shopify?.images ?? []);
}

function shopifyCount(r: ShootRow) {
  return r.shopify?.mediaCount ?? 0;
}

function stockLabel(r: ShootRow) {
  return r.stock == null ? "—" : String(r.stock);
}

export function ShootPlanner({ season, rows: initial }: { season: string; rows: ShootRow[] }) {
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState<Tab>("new");
  const [lividOnly, setLividOnly] = useState(true);
  const [q, setQ] = useState("");
  const [drops, setDrops] = useState<string[]>([]);
  const [bucket, setBucket] = useState<ShootBucket | null>(null);
  const [carry, setCarry] = useState<CarryFilter>("all");
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
        : listRows;

  function patch(entryId: string, change: Partial<ShootRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.entryId !== entryId) return r;
        const next = { ...r, ...change };
        next.bucket = bucketFor(next.hasMedia, next.stock, next.cancelled);
        next.onShotList = isOnShotList(next.plan, next.bucket);
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
        body: JSON.stringify({ entryId: r.entryId, status: plan, note }),
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

  function exportCsv() {
    const label = tab === "list" ? "shot-list" : tab === "new" ? "new" : "carry-overs";
    downloadCsv(
      [
        "Season", "Drop", "Type", "Brand", "Style", "Colour", "SKU", "Category", "Gender",
        "Origo images", "Shopify images", "Stock", "Status", "Why not shot", "Plan", "Note",
        "On shot list", "Shopify admin",
      ],
      shown.map((r) => [
        season,
        r.drop ?? "",
        r.origin === "NEW" ? "New" : "Carry-over",
        r.brand,
        r.styleName,
        r.colour,
        r.sku,
        r.category,
        r.gender ?? "",
        String(r.origo.count),
        r.shopify ? String(shopifyCount(r)) : "Not on Shopify",
        r.stock == null ? "" : String(r.stock),
        BUCKET_LABELS[r.bucket],
        r.reason ?? "",
        r.plan ? PLAN_LABELS[r.plan] : "",
        r.note ?? "",
        r.onShotList ? "Yes" : "No",
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
              {t.id === "new" ? newRows.length : t.id === "carry" ? carryRows.length : listRows.length}
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
        <div className="ml-auto">
          <Button size="sm" onClick={exportCsv} disabled={!shown.length}>
            Export CSV
          </Button>
        </div>
      </div>

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
            <CarryCard key={r.entryId} row={r} onOpen={() => setOpenId(r.colorwayId)} onSave={save} />
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
                <TableRow key={r.entryId} row={r} onOpen={() => setOpenId(r.colorwayId)} onSave={save} />
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
              return { ...r, origo, hasMedia, bucket, onShotList: isOnShotList(r.plan, bucket) };
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

type SaveFn = (r: ShootRow, plan: ShootStatus | null, note: string | null) => void;

function Thumb({ url, size }: { url: string | undefined; size: "sm" | "lg" }) {
  const cls = size === "sm" ? "size-11" : "aspect-[3/4] w-full";
  if (!url) return <div className={cn(cls, "flex items-center justify-center bg-hover text-fine text-muted-foreground")}>—</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={catalogImageSrc(url) ?? ""} alt="" loading="lazy" className={cn(cls, "object-cover")} />;
}

function PlanControls({ row, onSave }: { row: ShootRow; onSave: SaveFn }) {
  const [note, setNote] = useState(row.note ?? "");
  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={row.plan ?? ""}
        onChange={(e) => onSave(row, (e.target.value || null) as ShootStatus | null, row.note)}
        className="h-8 border border-line bg-paper px-2 text-fine"
        aria-label="Plan"
      >
        <option value="">{row.onShotList && !row.plan ? "Auto · on list" : "Auto"}</option>
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
      {row.drop === "UNCERTAIN" && <span className="text-fine text-muted-foreground">Drop uncertain</span>}
    </div>
  );
}

function TableRow({ row: r, onOpen, onSave }: { row: ShootRow; onOpen: () => void; onSave: SaveFn }) {
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
              {r.brand && !/^livid/i.test(r.brand) ? ` · ${r.brand}` : ""}
            </span>
          </span>
        </button>
      </td>
      <td className="px-3 py-2 text-fine">{r.drop ?? "—"}</td>
      <td className="px-3 py-2 text-right text-fine tabular-nums">
        <MediaCounts row={r} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{stockLabel(r)}</td>
      <td className="px-3 py-2">
        <StatusCell row={r} />
      </td>
      <td className="w-52 px-3 py-2">
        <PlanControls key={r.note ?? ""} row={r} onSave={onSave} />
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
    </span>
  );
}

function CarryCard({ row: r, onOpen, onSave }: { row: ShootRow; onOpen: () => void; onSave: SaveFn }) {
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
            Stock {stockLabel(r)}
            {r.origo.men || r.origo.women ? ` · Men ${r.origo.men} / Women ${r.origo.women}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right text-fine tabular-nums">
          <MediaCounts row={r} />
        </div>
      </div>
      <PlanControls key={r.note ?? ""} row={r} onSave={onSave} />
    </div>
  );
}
