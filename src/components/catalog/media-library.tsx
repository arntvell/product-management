"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { catalogImageSrc } from "@/lib/catalog-image";
import { MediaPanel } from "./media-panel";
import { MultiSelect } from "@/components/ui/multi-select";

export interface MediaLibraryRow {
  id: string;
  sku: string;
  name: string;
  styleName: string;
  brand: string;
  seasons: string[];
  images: string[];
  count: number;
  roles: { GALLERY: number; FLAT: number; MEN: number; WOMEN: number };
  /** A Threadflow season image, when Origo has no media of its own yet. */
  seasonImage: string | null;
  onShopify: boolean;
}

type Has = "all" | "none" | "some";
const STORE = "origo:catalog-media:filters";

export function MediaLibrary({ rows: initial }: { rows: MediaLibraryRow[] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [has, setHas] = useState<Has>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // Remembered for the session, like the grids' filters.
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const s = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
      if (s) {
        setQ(s.q ?? "");
        setBrands(s.brands ?? []);
        setSeasons(s.seasons ?? []);
        setHas(s.has ?? "all");
      }
    } catch {
      /* start unfiltered */
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ q, brands, seasons, has }));
    } catch {
      /* not remembered */
    }
  }, [q, brands, seasons, has]);

  const brandOptions = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), [rows]);
  const seasonOptions = useMemo(() => [...new Set(rows.flatMap((r) => r.seasons))].sort(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (brands.length && !brands.includes(r.brand)) return false;
      if (seasons.length && !r.seasons.some((s) => seasons.includes(s))) return false;
      if (has === "none" && r.count > 0) return false;
      if (has === "some" && r.count === 0) return false;
      if (!needle) return true;
      return (
        r.sku.toLowerCase().includes(needle) ||
        r.name.toLowerCase().includes(needle) ||
        r.styleName.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, brands, seasons, has]);

  const without = shown.filter((r) => r.count === 0).length;
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 12,
  });

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search style, colour, SKU…"
          className="h-8 w-64"
        />
        <MultiSelect options={brandOptions} selected={brands} onChange={setBrands} placeholder="All brands" className="h-8" />
        <MultiSelect options={seasonOptions} selected={seasons} onChange={setSeasons} placeholder="All seasons" className="h-8" />
        <div className="flex gap-1">
          {(["all", "none", "some"] as const).map((h) => (
            <button
              key={h}
              onClick={() => setHas(h)}
              className={cn(
                "h-8 border px-2.5 text-fine",
                has === h ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {h === "all" ? "All" : h === "none" ? "No images" : "Has images"}
            </button>
          ))}
        </div>
        <span className="text-fine text-muted-foreground">
          {shown.length} products · {without} without images
        </span>
      </div>

      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 overflow-auto border bg-paper">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const r = shown[vi.index];
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(r.id)}
                className="absolute left-0 flex w-full items-center gap-3 border-b border-line px-3 text-left hover:bg-hover"
                style={{ top: vi.start, height: 64 }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">
                    {r.styleName} · {r.name}
                  </div>
                  <div className="truncate text-fine text-muted-foreground">
                    <span className="font-mono">{r.sku}</span> · {r.brand}
                    {r.seasons.length ? ` · ${r.seasons.join(", ")}` : ""}
                    {r.onShopify ? " · on Shopify" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {r.images.length ? (
                    r.images.map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={catalogImageSrc(u) ?? ""} alt="" className="size-11 object-cover" />
                    ))
                  ) : r.seasonImage ? (
                    <span className="flex items-center gap-1 text-fine text-muted-foreground">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={catalogImageSrc(r.seasonImage) ?? ""} alt="" className="size-11 object-cover opacity-60" />
                      Threadflow only
                    </span>
                  ) : (
                    <span className="text-fine text-ink">No images</span>
                  )}
                </div>
                <div className="w-40 shrink-0 text-right text-fine tabular-nums text-muted-foreground">
                  {r.count ? (
                    <>
                      {r.count} · G{r.roles.GALLERY} F{r.roles.FLAT} M{r.roles.MEN} W{r.roles.WOMEN}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <MediaPanel
        colorwayId={openId}
        onClose={() => setOpenId(null)}
        onChanged={(id, items) =>
          setRows((prev) =>
            prev.map((r) =>
              r.id === id
                ? {
                    ...r,
                    count: items.length,
                    images: items.map((i) => i.url).slice(0, 6),
                    roles: {
                      GALLERY: items.filter((i) => i.role === "GALLERY").length,
                      FLAT: items.filter((i) => i.role === "FLAT").length,
                      MEN: items.filter((i) => i.role === "MEN").length,
                      WOMEN: items.filter((i) => i.role === "WOMEN").length,
                    },
                  }
                : r
            )
          )
        }
      />
    </>
  );
}
