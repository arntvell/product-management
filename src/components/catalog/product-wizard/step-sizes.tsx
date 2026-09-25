"use client";

import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { buildVariantSku } from "@/lib/master/sku";
import type { StepProps } from "./types";
import { newKey } from "./types";
import type { DraftVariant } from "@/lib/master/draft-payload";
import type { SizeSystemView } from "@/lib/master/size-systems";

export function StepSizes({ payload, update, options }: StepProps) {
  const systems = options.sizeSystems.filter((s) => !s.archived);

  if (!payload.colorways.length)
    return <p className="text-sm text-muted-foreground">Add a colourway first.</p>;

  if (!systems.length)
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No size systems yet.{" "}
        <Link href="/catalog/size-systems" className="underline underline-offset-2">
          Create one
        </Link>{" "}
        — the builder mints variants from them, so the order and SKU tokens come from there.
      </p>
    );

  function setSystem(colorwayKey: string, systemId: string) {
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) =>
        cw.key === colorwayKey ? { ...cw, sizeSystemId: systemId || null, variants: [] } : cw
      ),
    }));
  }

  function toggle(colorwayKey: string, system: SizeSystemView, entryId: string) {
    const entry = system.entries.find((e) => e.id === entryId);
    if (!entry) return;
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) => {
        if (cw.key !== colorwayKey) return cw;
        const has = cw.variants.some((v) => v.entryId === entryId);
        const variants = has
          ? cw.variants.filter((v) => v.entryId !== entryId)
          : [
              ...cw.variants,
              makeVariant(cw.colorwaySku, entry),
            ].sort(byPosition(system));
        // Picking a size settles the system too. Without this a colourway that
        // merely INHERITED the brand default would keep a null systemId, and the
        // next render's fallback could move under it.
        return { ...cw, sizeSystemId: system.id, variants };
      }),
    }));
  }

  function setAll(colorwayKey: string, system: SizeSystemView, on: boolean) {
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) => {
        if (cw.key !== colorwayKey) return cw;
        return {
          ...cw,
          sizeSystemId: system.id,
          variants: on
            ? system.entries
                .filter((e) => !e.archived)
                .map((e) => {
                  const existing = cw.variants.find((v) => v.entryId === e.id);
                  return existing ?? makeVariant(cw.colorwaySku, e);
                })
            : [],
        };
      }),
    }));
  }

  /** Copy the first colourway's selection down. The speed lever. */
  function applyToAll() {
    const first = payload.colorways[0];
    if (!first) return;
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw, i) =>
        i === 0
          ? cw
          : {
              ...cw,
              sizeSystemId: first.sizeSystemId,
              variants: first.variants.map((v) => ({
                ...v,
                key: newKey(),
                variantSku: buildVariantSku(cw.colorwaySku, v.skuToken),
                // Barcodes are per garment, never copied.
                barcode: null,
                barcodeSource: null,
              })),
            }
      ),
    }));
  }

  return (
    <div className="space-y-4">
      {payload.colorways.length > 1 ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={applyToAll}>
            Use the first colourway&apos;s sizes for all
          </Button>
        </div>
      ) : null}

      {payload.colorways.map((cw) => {
        // A colourway added before the brand's defaults arrived has no system of
        // its own; fall back to the brand default rather than showing "choose".
        const systemId = cw.sizeSystemId || payload.template.defaultSizeSystemId || "";
        const system = systems.find((s) => s.id === systemId) ?? null;
        const active = system?.entries.filter((e) => !e.archived) ?? [];
        return (
          <div key={cw.key} className="rounded-md border p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{cw.name || "Unnamed colourway"}</div>
                <code className="text-xs text-muted-foreground">{cw.colorwaySku}</code>
              </div>
              <div>
                <Label className="text-xs">Size system</Label>
                <select
                  className="mt-1.5 h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={systemId}
                  onChange={(e) => setSystem(cw.key, e.target.value)}
                >
                  <option value="">— choose —</option>
                  {systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {system ? (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => setAll(cw.key, system, true)}
                  >
                    all
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => setAll(cw.key, system, false)}
                  >
                    none
                  </button>
                  <span className="text-muted-foreground">
                    {cw.variants.length} of {active.length} selected
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {active.map((e) => {
                    const on = cw.variants.some((v) => v.entryId === e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggle(cw.key, system, e.id)}
                        title={buildVariantSku(cw.colorwaySku, e.skuToken)}
                        className={
                          "rounded border px-2.5 py-1 text-xs transition-colors " +
                          (on
                            ? "border-foreground bg-foreground text-background"
                            : "hover:bg-muted")
                        }
                      >
                        {e.sizeLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function makeVariant(
  colorwaySku: string,
  entry: { id: string; sizeLabel: string; dim1: string; dim2: string | null; skuToken: string }
): DraftVariant {
  return {
    key: newKey(),
    entryId: entry.id,
    sizeLabel: entry.sizeLabel,
    dim1: entry.dim1,
    dim2: entry.dim2,
    skuToken: entry.skuToken,
    variantSku: buildVariantSku(colorwaySku, entry.skuToken),
    barcode: null,
    barcodeSource: null,
  };
}

/** Keep a run in the size system's order, not the order you clicked. */
function byPosition(system: SizeSystemView) {
  const pos = new Map(system.entries.map((e) => [e.id, e.position]));
  return (a: DraftVariant, b: DraftVariant) =>
    (pos.get(a.entryId ?? "") ?? 0) - (pos.get(b.entryId ?? "") ?? 0);
}
