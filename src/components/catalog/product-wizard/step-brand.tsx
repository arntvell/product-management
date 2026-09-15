"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  PUBLISH_CHANNELS,
  PUBLISH_CHANNEL_LABELS,
  type PublishChannelKey,
} from "@/lib/master/fields";
import type { DraftTemplate } from "@/lib/master/draft-payload";
import type { StepProps } from "./types";
import type { ProductKind } from "@/generated/prisma/enums";

/** Every template field a brand default can fill. `category` is derived from
 *  `categoryId` by the picker, so it is set there rather than copied here. */
const TEMPLATE_KEYS = [
  "categoryId",
  "category",
  "gender",
  "hsCode",
  "customsDescription",
  "weightKg",
  "fiberComposition",
  "countryOfOrigin",
  "manufacturerId",
  "defaultSizeSystemId",
] as const satisfies readonly (keyof DraftTemplate)[];

const KINDS: ProductKind[] = [
  "MERCHANDISE",
  "AGGREGATE",
  "SAMPLE",
  "CONSUMABLE",
  "MATERIAL",
  "SERVICE",
];

export function StepBrand({ payload, update, options }: StepProps) {
  const external = options.brands.filter((b) => !b.isLivid);
  const [applied, setApplied] = useState<string | null>(null);

  /**
   * Pull the brand's saved defaults in and merge them.
   *
   * Merge, not overwrite: someone who has already typed an HS code on this draft
   * meant it, and a brand default must not quietly replace it. Only empty fields
   * are filled. Channels are the exception — they are a set, not a value, so an
   * explicitly configured set replaces the default rather than unioning with it.
   */
  async function applyBrandTemplate(brandId: string) {
    try {
      const res = await fetch(`/api/catalog/brands/${brandId}/template`);
      if (!res.ok) return;
      const { template } = (await res.json()) as {
        template: Record<string, unknown> | null;
      };
      if (!template) {
        setApplied("no defaults saved for this brand");
        return;
      }
      const str = (k: string) =>
        typeof template[k] === "string" ? (template[k] as string) : "";
      const chan = Array.isArray(template.channels)
        ? (template.channels as string[]).filter((c): c is PublishChannelKey =>
            (PUBLISH_CHANNELS as readonly string[]).includes(c)
          )
        : [];
      // Decide what to fill from the template as it stands now, outside the
      // updater — an updater can be invoked more than once for one state change,
      // and a count assembled inside it would double.
      const fill: Partial<DraftTemplate> = {};
      for (const k of TEMPLATE_KEYS) {
        if (!payload.template[k] && str(k)) fill[k] = str(k);
      }
      const filled = Object.keys(fill);
      update((p) => ({
        ...p,
        template: { ...p.template, ...fill },
        channels: chan.length ? chan : p.channels,
      }));
      setApplied(
        filled.length
          ? `brand defaults filled in: ${filled.length} field${filled.length === 1 ? "" : "s"}`
          : "brand defaults loaded — nothing was empty to fill"
      );
    } catch {
      // A failed lookup leaves the draft exactly as it was; the operator can
      // still type every field by hand, so this is not worth blocking on.
      setApplied("could not load this brand's defaults");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="brand" className="text-xs">
            Brand
          </Label>
          <select
            id="brand"
            className="mt-1.5 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={payload.brand.id ?? ""}
            onChange={(e) => {
              const b = external.find((x) => x.id === e.target.value);
              setApplied(null);
              update((p) => ({
                ...p,
                brand: {
                  id: b?.id ?? null,
                  name: b?.name ?? "",
                  skuToken: b?.skuToken ?? null,
                  isLivid: b?.isLivid ?? false,
                },
                // Changing brand invalidates the style — its SKU carries the
                // brand token, and an existing style belongs to one brand.
                style: null,
                colorways: [],
              }));
              if (b) void applyBrandTemplate(b.id);
            }}
          >
            <option value="">— choose a brand —</option>
            {external.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.skuToken ? ` (${b.skuToken})` : " — no SKU token"}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Livid is not listed: its product comes through the Threadflow feed.
          </p>
          {applied ? (
            <p className="mt-1 text-xs text-muted-foreground">{applied}</p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="season" className="text-xs">
            Season
          </Label>
          <select
            id="season"
            className="mt-1.5 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={payload.seasonId ?? ""}
            onChange={(e) => update((p) => ({ ...p, seasonId: e.target.value || null }))}
          >
            <option value="">— choose a season —</option>
            {options.seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="kind" className="text-xs">
          What these records are
        </Label>
        <select
          id="kind"
          className="mt-1.5 h-9 w-full max-w-sm rounded-md border bg-transparent px-3 text-sm"
          value={payload.kind}
          onChange={(e) => update((p) => ({ ...p, kind: e.target.value as ProductKind }))}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Set here rather than guessed from the SKU. An individual vintage garment is
          MERCHANDISE even though its SKU shape matches the store-vintage bulk buckets —
          the choice is recorded and locked, so the classifier cannot overrule it later.
        </p>
      </div>

      <div>
        <Label className="text-xs">Publish to</Label>
        <div className="mt-2 flex flex-wrap gap-4">
          {PUBLISH_CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={payload.channels.includes(c)}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    channels: e.target.checked
                      ? [...p.channels, c]
                      : p.channels.filter((x) => x !== c),
                  }))
                }
              />
              {PUBLISH_CHANNEL_LABELS[c]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          All three by default. Nothing is sent until you create — and each channel is
          pushed separately, so one failing does not hold up the others.
        </p>
      </div>
    </div>
  );
}
