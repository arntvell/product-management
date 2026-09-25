"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { buildStyleSku } from "@/lib/master/sku";
import type { StyleHit } from "@/lib/master/builder-search";
import type { StepProps } from "./types";
import { resyncSkus } from "./sku-tools";

export function StepStyle({ payload, update }: StepProps) {
  const [query, setQuery] = useState(payload.style?.styleName ?? "");
  const [hits, setHits] = useState<StyleHit[]>([]);
  const [searching, setSearching] = useState(false);
  const brandId = payload.brand.id;

  // Search across ALL seasons: a carry-over is the same style, and scoping to
  // the current season would hide exactly the row you want to pick.
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/catalog/builder/styles?brandId=${brandId}&q=${encodeURIComponent(query)}`
        );
        const json = await res.json();
        if (!cancelled) setHits(json.styles ?? []);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [brandId, query]);

  const selected = payload.style;
  const exactNameMatch = hits.find(
    (h) => h.styleName.toLowerCase() === query.trim().toLowerCase()
  );
  // "Barnes Japan Gravel" typed while "Barnes" exists is a colour of Barnes,
  // not a garment. Creating it as a style is the shape that put a thousand
  // one-colour styles in the catalogue and split them again in Loom — the
  // colour ends up in the style name and the colourway nests under itself.
  // Longest match wins, so "Fealy Twisted" beats "Fealy".
  const parentMatch = hits
    .filter((h) => query.trim().toLowerCase().startsWith(h.styleName.toLowerCase() + " "))
    .sort((a, b) => b.styleName.length - a.styleName.length)[0];

  function pickExisting(h: StyleHit) {
    update((p) =>
      resyncSkus({
        ...p,
        style: { mode: "existing", id: h.id, styleSku: h.styleSku, styleName: h.styleName },
        // An existing style already knows its customs block and category —
        // inherit rather than asking again.
        template: {
          ...p.template,
          category: h.category && h.category !== "Uncategorized" ? h.category : p.template.category,
          hsCode: h.hsCode ?? p.template.hsCode,
          customsDescription: h.customsDescription ?? p.template.customsDescription,
          weightKg: h.weightKg ?? p.template.weightKg,
          fiberComposition: h.fiberComposition ?? p.template.fiberComposition,
        },
      })
    );
  }

  function createNew() {
    const styleName = query.trim();
    if (!styleName) return;
    const styleSku = buildStyleSku({
      prefix: "EXT",
      brandToken: payload.brand.skuToken,
      brandName: payload.brand.name,
      style: styleName,
    });
    update((p) => resyncSkus({ ...p, style: { mode: "new", styleName, styleSku, manualSku: false } }));
  }

  if (!brandId)
    return <p className="text-sm text-muted-foreground">Choose a brand first.</p>;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="style-q" className="text-xs">
          Style name
        </Label>
        <Input
          id="style-q"
          className="mt-1.5"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Start typing — existing styles appear below"
          autoComplete="off"
        />
      </div>

      {selected ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">
                {selected.styleName}{" "}
                <span className="ml-1 rounded-full border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {selected.mode === "existing" ? "existing style" : "new style"}
                </span>
              </div>
              <code className="mt-1 block font-mono text-xs text-muted-foreground">
                {selected.styleSku}
              </code>
              {selected.mode === "existing" ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Its SKU is inherited exactly as it is. Existing SKUs are never rewritten,
                  so new colourways stay consistent with what this style is already called.
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update((p) => ({ ...p, style: null }))}
            >
              Change
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border">
          {searching && hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>
          ) : null}
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => pickExisting(h)}
              className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{h.styleName}</div>
                <code className="block truncate font-mono text-xs text-muted-foreground">
                  {h.styleSku}
                </code>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <div>
                  {h.colorways} colourway{h.colorways === 1 ? "" : "s"}
                </div>
                {h.seasons.length ? <div>{h.seasons.join(", ")}</div> : null}
              </div>
            </button>
          ))}
          {query.trim() ? (
            <div className="border-t px-3 py-2">
              {exactNameMatch ? (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                  {payload.brand.name} already has a style called “{exactNameMatch.styleName}”.
                  Pick it above unless this really is a different garment.
                </p>
              ) : null}
              {!exactNameMatch && parentMatch ? (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                  This reads like a colour of “{parentMatch.styleName}”, not a garment
                  of its own — pick that style above and add “
                  {query.trim().slice(parentMatch.styleName.length).trim()}” as a
                  colourway. Create it as a style only if it is a different garment,
                  the way Fealy Twisted is not Fealy.
                </p>
              ) : null}
              <Button size="sm" variant="outline" onClick={createNew}>
                Create new style “{query.trim()}”
              </Button>
            </div>
          ) : null}
          {!searching && hits.length === 0 && !query.trim() ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No styles for this brand yet — type a name to create the first.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
