"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { buildVariantSku, isOneOfOne, normalizeSku } from "@/lib/master/sku";
import { barcodeKey, rejectionReason } from "@/lib/master/barcode";
import type { DraftColorway } from "@/lib/master/draft-payload";
import type { SizeSystemView } from "@/lib/master/size-systems";
import type { ColorwayHit } from "@/lib/master/builder-search";
import { colorwayAnchor } from "./types";

/**
 * One colourway, filled top to bottom: what it is, which sizes it comes in,
 * what it costs, and the barcode on each size. Everything a colourway owns is
 * in one card, so it is finished in one place instead of being revisited on
 * four separate steps.
 */
export function ColorwayCard({
  draftId,
  cw,
  index,
  styleName,
  systems,
  defaultSystemId,
  clash,
  onPatch,
  onResetSku,
  onRemove,
  onSetSystem,
  onToggleSize,
  onSetAllSizes,
  onSetPrice,
  onSetBarcode,
}: {
  draftId: string;
  cw: DraftColorway;
  index: number;
  styleName: string;
  systems: SizeSystemView[];
  defaultSystemId: string;
  /** An existing colourway of this style with the same name. */
  clash: ColorwayHit | undefined;
  onPatch: (changes: Partial<DraftColorway>) => void;
  onResetSku: () => void;
  onRemove: () => void;
  onSetSystem: (systemId: string) => void;
  onToggleSize: (system: SizeSystemView, entryId: string) => void;
  onSetAllSizes: (system: SizeSystemView, on: boolean) => void;
  onSetPrice: (field: "COST" | "MSRP", value: string) => void;
  onSetBarcode: (variantKey: string, value: string) => void;
}) {
  // A colourway added before the brand's defaults arrived has no system of
  // its own; fall back to the brand default rather than showing "choose".
  const systemId = cw.sizeSystemId || defaultSystemId || "";
  const system = systems.find((s) => s.id === systemId) ?? null;
  const active = system?.entries.filter((e) => !e.archived) ?? [];
  const blankBarcodes = cw.variants.filter((v) => !v.barcode).length;
  const id = useId();

  return (
    <section id={colorwayAnchor(draftId, cw.key)} className="scroll-mt-4 border">
      {/* What it is */}
      <div className="border-b p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-fine text-muted-foreground">
            Colourway {index + 1}
          </span>
          <Button size="sm" variant="outline" onClick={onRemove}>
            Remove
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1.5fr_7rem]">
          <div>
            <Label htmlFor={`${id}-name`} className="text-fine">
              Colourway name
            </Label>
            <Input
              id={`${id}-name`}
              className="mt-1.5"
              value={cw.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder="Dark Brown"
            />
          </div>
          <div>
            <Label htmlFor={`${id}-color`} className="text-fine">
              Colour
            </Label>
            <Input
              id={`${id}-color`}
              className="mt-1.5"
              value={cw.color ?? ""}
              onChange={(e) => onPatch({ color: e.target.value || null })}
            />
          </div>
          <div>
            <Label htmlFor={`${id}-swatch`} className="text-fine">
              Swatch
            </Label>
            <Input
              id={`${id}-swatch`}
              className="mt-1.5"
              value={cw.swatchHex ?? ""}
              onChange={(e) => onPatch({ swatchHex: e.target.value || null })}
              placeholder="#3b2a1a"
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="bg-muted px-1.5 py-0.5 font-mono text-fine">
            {cw.colorwaySku || "—"}
          </code>
          {cw.manualSku ? (
            <>
              <span className="inline-flex h-6 items-center border border-ink px-2 text-meta uppercase text-ink">
                edited by hand
              </span>
              <Input
                className="h-7 max-w-xs font-mono text-fine"
                value={cw.colorwaySku}
                onChange={(e) =>
                  onPatch({ colorwaySku: normalizeSku(e.target.value) })
                }
              />
              <button
                type="button"
                className="text-fine text-muted-foreground underline underline-offset-2"
                onClick={onResetSku}
              >
                reset
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-fine text-muted-foreground underline underline-offset-2"
              onClick={() => onPatch({ manualSku: true })}
            >
              edit
            </button>
          )}
        </div>

        {clash ? (
          <p className="mt-2 text-fine text-ink">
            {styleName} already has a colourway called “{clash.name}” (
            <code className="font-mono">{clash.colorwaySku}</code>). Creating a
            second one is only right if it is genuinely a different garment.
          </p>
        ) : null}
        {isOneOfOne(cw.colorwaySku) ? (
          <p className="mt-2 text-fine text-muted-foreground">
            One-of-one SKU. Two garments here may share a name, so a SKU clash
            is suffixed rather than refused.
          </p>
        ) : null}
      </div>

      {/* Sizes */}
      <div className="border-b p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="text-fine text-muted-foreground">
            Sizes
            {system
              ? ` · ${cw.variants.length} of ${active.length} selected`
              : ""}
          </div>
          <select
            aria-label="Size system"
            className="h-8 border bg-transparent px-2 text-fine"
            value={systemId}
            onChange={(e) => onSetSystem(e.target.value)}
          >
            <option value="">— size system —</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {system ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {active.map((e) => {
              const on = cw.variants.some((v) => v.entryId === e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onToggleSize(system, e.id)}
                  title={buildVariantSku(cw.colorwaySku, e.skuToken)}
                  className={
                    " border px-2.5 py-1 text-fine transition-colors " +
                    (on
                      ? "border-foreground bg-foreground text-background"
                      : "hover:bg-muted")
                  }
                >
                  {e.sizeLabel}
                </button>
              );
            })}
            <span className="ml-2 flex gap-3 text-fine">
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => onSetAllSizes(system, true)}
              >
                all
              </button>
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => onSetAllSizes(system, false)}
              >
                none
              </button>
            </span>
          </div>
        ) : (
          <p className="mt-2 text-fine text-muted-foreground">
            Choose a size system.
          </p>
        )}
      </div>

      {/* Prices */}
      <div className="border-b p-3">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <div>
            <Label htmlFor={`${id}-cost`} className="text-fine">
              Cost (NOK)
            </Label>
            <Input
              id={`${id}-cost`}
              className="mt-1.5 h-8 text-right tabular-nums"
              inputMode="decimal"
              value={cw.prices.COST ?? ""}
              onChange={(e) => onSetPrice("COST", e.target.value)}
              placeholder="889.00"
            />
          </div>
          <div>
            <Label htmlFor={`${id}-msrp`} className="text-fine">
              MSRP (NOK)
            </Label>
            <Input
              id={`${id}-msrp`}
              className={
                "mt-1.5 h-8 text-right tabular-nums " +
                (cw.prices.MSRP ? "" : "border-ink")
              }
              inputMode="decimal"
              value={cw.prices.MSRP ?? ""}
              onChange={(e) => onSetPrice("MSRP", e.target.value)}
              placeholder="2600.00"
            />
          </div>
        </div>
      </div>

      {/* Barcodes, one per selected size */}
      <div className="p-3">
        <div className="text-fine text-muted-foreground">
          Barcodes
          {cw.variants.length
            ? blankBarcodes
              ? ` · ${blankBarcodes} of ${cw.variants.length} blank (optional)`
              : ` · all ${cw.variants.length} filled`
            : " · tick sizes above first"}
        </div>
        {cw.variants.length ? (
          <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {cw.variants.map((v) => {
              const value = v.barcode ?? "";
              const bad = value ? !barcodeKey(value) : false;
              return (
                <div
                  key={v.key}
                  className="grid grid-cols-[4rem_1fr] items-center gap-2"
                >
                  <span className="truncate text-body" title={v.variantSku}>
                    {v.sizeLabel}
                  </span>
                  <div>
                    <Input
                      className={
                        "h-8 font-mono text-fine " +
                        (bad ? "border-destructive text-destructive" : "")
                      }
                      value={value}
                      inputMode="numeric"
                      placeholder="EAN-13"
                      aria-label={`Barcode ${v.sizeLabel}`}
                      onChange={(e) =>
                        onSetBarcode(v.key, e.target.value.trim())
                      }
                    />
                    {bad ? (
                      <p className="mt-0.5 text-fine text-destructive">
                        {rejectionReason(value)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
