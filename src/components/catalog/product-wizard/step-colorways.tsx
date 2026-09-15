"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { normalizeSku, isOneOfOne } from "@/lib/master/sku";
import type { ColorwayHit } from "@/lib/master/builder-search";
import type { StepProps } from "./types";
import { newKey } from "./types";
import { restyleColorway } from "./sku-tools";

export function StepColorways({ payload, update }: StepProps) {
  const style = payload.style;
  const [existing, setExisting] = useState<ColorwayHit[]>([]);
  const [bulk, setBulk] = useState("");

  // Show what this style already has, so a duplicate name is visible before it
  // becomes a SKU collision.
  useEffect(() => {
    if (style?.mode !== "existing") {
      setExisting([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/catalog/builder/colorways?styleId=${style.id}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setExisting(j.colorways ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [style]);

  if (!style) return <p className="text-sm text-muted-foreground">Choose a style first.</p>;

  const taken = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e]));

  function addColorways(names: string[]) {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) return;
    update((p) => ({
      ...p,
      colorways: [
        ...p.colorways,
        ...clean.map((name) =>
          restyleColorway(
            {
              key: newKey(),
              name,
              color: name,
              swatchHex: null,
              colorwaySku: "",
              manualSku: false,
              kind: null,
              sizeSystemId: null,
              variants: [],
              prices: {},
            },
            style!.styleSku
          )
        ),
      ],
    }));
  }

  function patch(key: string, changes: Partial<(typeof payload.colorways)[number]>) {
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) => {
        if (cw.key !== key) return cw;
        const next = { ...cw, ...changes };
        // A rename re-derives the SKU, unless someone has taken it over by hand.
        return changes.name !== undefined && !next.manualSku
          ? restyleColorway(next, style!.styleSku)
          : next;
      }),
    }));
  }

  return (
    <div className="space-y-5">
      {existing.length ? (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-xs font-medium">
            {style.styleName} already has {existing.length} colourway
            {existing.length === 1 ? "" : "s"}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {existing.map((e) => (
              <span
                key={e.id}
                className="rounded border bg-background px-2 py-0.5 text-xs"
                title={e.colorwaySku}
              >
                {e.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {payload.colorways.map((cw) => {
          const clash = taken.get(cw.name.trim().toLowerCase());
          return (
            <div key={cw.key} className="rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-[2fr_1.5fr_5rem_auto] sm:items-end">
                <div>
                  <Label className="text-xs">Colourway name</Label>
                  <Input
                    className="mt-1.5"
                    value={cw.name}
                    onChange={(e) => patch(cw.key, { name: e.target.value })}
                    placeholder="Dark Brown"
                  />
                </div>
                <div>
                  <Label className="text-xs">Colour</Label>
                  <Input
                    className="mt-1.5"
                    value={cw.color ?? ""}
                    onChange={(e) => patch(cw.key, { color: e.target.value || null })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Swatch</Label>
                  <Input
                    className="mt-1.5"
                    value={cw.swatchHex ?? ""}
                    onChange={(e) => patch(cw.key, { swatchHex: e.target.value || null })}
                    placeholder="#3b2a1a"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update((p) => ({
                      ...p,
                      colorways: p.colorways.filter((x) => x.key !== cw.key),
                    }))
                  }
                >
                  Remove
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {cw.colorwaySku || "—"}
                </code>
                {cw.manualSku ? (
                  <span className="rounded-full border border-amber-400 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                    edited by hand
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2"
                    onClick={() => patch(cw.key, { manualSku: true })}
                  >
                    edit
                  </button>
                )}
                {cw.manualSku ? (
                  <>
                    <Input
                      className="h-7 max-w-xs font-mono text-xs"
                      value={cw.colorwaySku}
                      onChange={(e) =>
                        patch(cw.key, { colorwaySku: normalizeSku(e.target.value) })
                      }
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2"
                      onClick={() =>
                        update((p) => ({
                          ...p,
                          colorways: p.colorways.map((x) =>
                            x.key === cw.key
                              ? restyleColorway({ ...x, manualSku: false }, style.styleSku)
                              : x
                          ),
                        }))
                      }
                    >
                      reset
                    </button>
                  </>
                ) : null}
              </div>

              {clash ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {style.styleName} already has a colourway called “{clash.name}” (
                  <code className="font-mono">{clash.colorwaySku}</code>). Creating a second
                  one is only right if it is genuinely a different garment.
                </p>
              ) : null}
              {isOneOfOne(cw.colorwaySku) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  One-of-one SKU. Two garments here may share a name, so a SKU clash is
                  suffixed rather than refused.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Button size="sm" variant="outline" onClick={() => addColorways(["New colourway"])}>
          + Colourway
        </Button>
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor="bulk" className="text-xs">
            Or paste a list, one name per line
          </Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="bulk"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder="Dark Brown, Black, Marine"
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (!text.includes("\n")) return;
                e.preventDefault();
                addColorways(text.split(/\r?\n/));
              }}
            />
            <Button
              size="sm"
              disabled={!bulk.trim()}
              onClick={() => {
                addColorways(bulk.split(/[,\n]/));
                setBulk("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      {payload.colorways.length ? (
        <p className="text-xs text-muted-foreground">
          {payload.colorways.length} colourway
          {payload.colorways.length === 1 ? "" : "s"} · all under{" "}
          <code className="font-mono">{style.styleSku}</code>
        </p>
      ) : null}
    </div>
  );
}
