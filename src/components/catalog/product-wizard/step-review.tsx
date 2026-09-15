"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PUBLISH_CHANNEL_LABELS } from "@/lib/master/fields";
import type { PreflightReport } from "@/lib/master/finalize";
import type { StepProps } from "./types";

export function StepReview({
  payload,
  options,
  report,
  checking,
  onCheck,
  onCreate,
  creating,
  onJumpTo,
}: StepProps & {
  report: PreflightReport | null;
  checking: boolean;
  onCheck: () => void;
  onCreate: () => void;
  creating: boolean;
  onJumpTo: (step: "colorways" | "sizes" | "barcodes") => void;
}) {
  const [open, setOpen] = useState(true);
  const season = options.seasons.find((s) => s.id === payload.seasonId);
  const variants = payload.colorways.reduce((a, c) => a + c.variants.length, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-4">
        <Stat label="Brand" value={payload.brand.name || "—"} />
        <Stat label="Season" value={season?.code ?? "—"} />
        <Stat
          label="Style"
          value={payload.style ? payload.style.styleName : "—"}
          sub={payload.style?.mode === "existing" ? "existing" : "new"}
        />
        <Stat label="Will create" value={`${payload.colorways.length} × ${variants}`} sub="colourways × sizes" />
      </div>

      <div className="rounded-md border p-4">
        <div className="text-xs font-medium text-muted-foreground">Publishing to</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {payload.channels.length ? (
            payload.channels.map((c) => (
              <span key={c} className="rounded-full border px-2.5 py-0.5 text-xs">
                {PUBLISH_CHANNEL_LABELS[c]}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">nothing selected</span>
          )}
        </div>
      </div>

      {report ? (
        <div className="space-y-3">
          {report.collisions.length ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
              <div className="text-sm font-medium text-destructive">
                {report.collisions.length} collision
                {report.collisions.length === 1 ? "" : "s"} — nothing will be created
              </div>
              <ul className="mt-2 space-y-1.5 text-xs">
                {report.collisions.map((c, i) => (
                  <li key={i}>
                    <code className="font-mono">{c.proposed}</code>{" "}
                    <span className="text-muted-foreground">
                      {c.matches.map((m) => `${m.sku} — ${m.reason}`).join("; ")}
                    </span>
                    {c.row.colorwayKey ? (
                      <button
                        type="button"
                        className="ml-2 underline underline-offset-2"
                        onClick={() =>
                          onJumpTo(c.level === "variant" ? "sizes" : "colorways")
                        }
                      >
                        fix
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.errors.length ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
              <div className="text-sm font-medium text-destructive">Not ready</div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                {report.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.warnings.length ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Worth knowing
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-900 dark:text-amber-200">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.ok ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              Ready. {report.counts.styles ? "1 new style, " : "Existing style, "}
              {report.counts.colorways} colourways, {report.counts.variants} variants,{" "}
              {report.counts.prices} prices.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-md border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium"
          onClick={() => setOpen((v) => !v)}
        >
          Everything that will be created
          <span className="text-xs text-muted-foreground">{open ? "hide" : "show"}</span>
        </button>
        {open ? (
          <div className="space-y-3 border-t px-4 py-3 text-sm">
            {payload.style ? (
              <div>
                <code className="font-mono text-xs">{payload.style.styleSku}</code>{" "}
                <span className="text-muted-foreground">{payload.style.styleName}</span>
              </div>
            ) : null}
            {payload.colorways.map((cw) => (
              <div key={cw.key} className="pl-4">
                <div>
                  <code className="font-mono text-xs">{cw.colorwaySku}</code>{" "}
                  <span className="text-muted-foreground">{cw.name}</span>
                  {cw.prices.MSRP ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {cw.prices.COST ? `${cw.prices.COST} / ` : ""}
                      {cw.prices.MSRP} NOK
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 pl-4">
                  {cw.variants.map((v) => (
                    <span
                      key={v.key}
                      title={v.variantSku}
                      className={
                        "rounded border px-1.5 py-0.5 font-mono text-[11px] " +
                        (v.barcode ? "" : "border-dashed text-muted-foreground")
                      }
                    >
                      {v.sizeLabel}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : "Check again"}
        </Button>
        <Button disabled={creating || !report?.ok} onClick={onCreate}>
          {creating ? "Creating…" : "Create products"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
