"use client";

import { Label } from "@/components/ui/label";
import { PUBLISH_CHANNELS, PUBLISH_CHANNEL_LABELS } from "@/lib/master/fields";
import type { StepProps } from "./types";
import type { ProductKind } from "@/generated/prisma/enums";

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
