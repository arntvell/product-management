"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StepProps } from "./types";

export function StepPrices({ payload, update }: StepProps) {
  if (!payload.colorways.length)
    return <p className="text-sm text-muted-foreground">Add a colourway first.</p>;

  function setPrice(key: string, field: "COST" | "MSRP", value: string) {
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) =>
        cw.key === key ? { ...cw, prices: { ...cw.prices, [field]: value } } : cw
      ),
    }));
  }

  /** Fill every row from the first — the same affordance the bulk editor has. */
  function fillDown(field: "COST" | "MSRP") {
    const value = payload.colorways[0]?.prices[field] ?? "";
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) => ({ ...cw, prices: { ...cw.prices, [field]: value } })),
    }));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        NOK. Cost is what Livid pays, MSRP is the retail price — both stored against the
        chosen season, so a re-buy at a different landed cost does not overwrite history.
      </p>

      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[1fr_9rem_9rem] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div>Colourway</div>
            <div className="flex items-center justify-between">
              Cost
              {payload.colorways.length > 1 ? (
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => fillDown("COST")}
                >
                  fill down
                </button>
              ) : null}
            </div>
            <div className="flex items-center justify-between">
              MSRP
              {payload.colorways.length > 1 ? (
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => fillDown("MSRP")}
                >
                  fill down
                </button>
              ) : null}
            </div>
          </div>
          {payload.colorways.map((cw) => (
            <div
              key={cw.key}
              className="grid grid-cols-[1fr_9rem_9rem] items-center gap-3 border-b px-3 py-2 last:border-0"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">{cw.name || "Unnamed"}</div>
                <code className="block truncate text-xs text-muted-foreground">
                  {cw.colorwaySku}
                </code>
              </div>
              <Input
                className="h-8 text-right tabular-nums"
                inputMode="decimal"
                value={cw.prices.COST ?? ""}
                onChange={(e) => setPrice(cw.key, "COST", e.target.value)}
                placeholder="889.00"
              />
              <Input
                className="h-8 text-right tabular-nums"
                inputMode="decimal"
                value={cw.prices.MSRP ?? ""}
                onChange={(e) => setPrice(cw.key, "MSRP", e.target.value)}
                placeholder="2600.00"
              />
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-md border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Customs and classification
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Prefilled from the brand and, for an existing style, from that style. Sent to Loom
          and Shopify — Sitoo has no field for any of it.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TemplateField label="Category" field="category" payload={payload} update={update} />
          <TemplateField label="HS code" field="hsCode" payload={payload} update={update} />
          <TemplateField
            label="Country of origin"
            field="countryOfOrigin"
            payload={payload}
            update={update}
          />
          <TemplateField
            label="Weight (kg)"
            field="weightKg"
            payload={payload}
            update={update}
          />
          <TemplateField
            label="Fibre composition"
            field="fiberComposition"
            payload={payload}
            update={update}
          />
          <TemplateField
            label="Customs description"
            field="customsDescription"
            payload={payload}
            update={update}
          />
        </div>
      </details>
    </div>
  );
}

function TemplateField({
  label,
  field,
  payload,
  update,
}: Pick<StepProps, "payload" | "update"> & {
  label: string;
  field: keyof StepProps["payload"]["template"];
}) {
  const value = payload.template[field];
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        className="mt-1.5"
        value={typeof value === "string" ? value : ""}
        onChange={(e) =>
          update((p) => ({ ...p, template: { ...p.template, [field]: e.target.value } }))
        }
      />
    </div>
  );
}
