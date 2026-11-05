"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PUBLISH_CHANNEL_LABELS, type PublishChannelKey } from "@/lib/master/fields";
import type { DraftPayloadV1 } from "@/lib/master/draft-payload";
import type { PreflightReport } from "@/lib/master/finalize";
import { colorwayAnchor, customsAnchor, type WizardOptions } from "./types";
import { missingCustoms } from "./customs-card";

/** One style of the build, as Review sees it. */
export interface ReviewItem {
  draftId: string;
  payload: DraftPayloadV1;
  report: PreflightReport | null;
  /** Already in the master, from an earlier press of Create. */
  created: boolean;
}

export function StepReview({
  items,
  channels,
  groupErrors,
  options,
  checking,
  onCheck,
  onCreate,
  creating,
  onJumpTo,
}: {
  items: ReviewItem[];
  channels: PublishChannelKey[];
  /** Problems between styles of this build, which no single draft's check sees. */
  groupErrors: string[];
  options: WizardOptions;
  checking: boolean;
  onCheck: () => void;
  onCreate: () => void;
  creating: boolean;
  /** Open the builder at an element: a colourway's card, or a customs card. */
  onJumpTo: (anchor: string) => void;
}) {
  const pending = items.filter((i) => !i.created);
  const ready =
    pending.length > 0 && !groupErrors.length && pending.every((i) => i.report?.ok);

  return (
    <div className="space-y-5">
      <div className="border p-4">
        <div className="text-fine text-muted-foreground">Publishing to</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {channels.length ? (
            channels.map((c) => (
              <span key={c} className="rounded-full border px-2.5 py-0.5 text-fine">
                {PUBLISH_CHANNEL_LABELS[c]}
              </span>
            ))
          ) : (
            <span className="text-fine text-muted-foreground">nothing selected</span>
          )}
        </div>
      </div>

      {groupErrors.length ? (
        <div className="border border-destructive/50 bg-destructive/5 p-4">
          <div className="text-body text-destructive">
            The styles in this build clash with each other — nothing will be created
          </div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-fine">
            {groupErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.map((item, i) => (
        <StyleReview
          key={item.draftId}
          item={item}
          heading={items.length > 1 ? `Style ${i + 1} of ${items.length}` : null}
          options={options}
          onJumpTo={onJumpTo}
        />
      ))}

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" disabled={checking} onClick={onCheck}>
          {checking ? "Checking…" : "Check again"}
        </Button>
        <Button disabled={creating || !ready} onClick={onCreate}>
          {creating
            ? "Creating…"
            : pending.length > 1 || items.length > 1
              ? `Create ${pending.length} style${pending.length === 1 ? "" : "s"}`
              : "Create products"}
        </Button>
      </div>
    </div>
  );
}

function StyleReview({
  item,
  heading,
  options,
  onJumpTo,
}: {
  item: ReviewItem;
  heading: string | null;
  options: WizardOptions;
  onJumpTo: (anchor: string) => void;
}) {
  const { payload, report, draftId } = item;
  const [open, setOpen] = useState(true);
  const season = options.seasons.find((s) => s.id === payload.seasonId);
  const variants = payload.colorways.reduce((a, c) => a + c.variants.length, 0);
  const customsGaps = missingCustoms(payload.template);

  return (
    <section className="space-y-3">
      {heading ? (
        <h3 className="text-body">
          {heading}
          <span className="ml-2 text-muted-foreground">
            {payload.style?.styleName || "no style chosen"}
          </span>
          {item.created ? (
            <span className="ml-2 border border-ink px-2 py-0.5 text-fine text-ink">created</span>
          ) : null}
        </h3>
      ) : null}

      <div className="grid gap-3 border p-4 sm:grid-cols-5">
        <Stat label="Brand" value={payload.brand.name || "—"} />
        <Stat label="Season" value={season?.code ?? "—"} />
        <Stat
          label="Style"
          value={payload.style ? payload.style.styleName : "—"}
          sub={payload.style?.mode === "existing" ? "existing" : "new"}
        />
        <Stat
          label="Category"
          value={payload.template.category || "—"}
          sub={
            payload.colorways.some((c) => c.categoryId)
              ? "some colourways override it"
              : undefined
          }
        />
        <Stat label="Will create" value={`${payload.colorways.length} × ${variants}`} sub="colourways × sizes" />
      </div>

      {item.created ? null : report ? (
        <div className="space-y-3">
          {report.collisions.length ? (
            <div className="border border-destructive/50 bg-destructive/5 p-4">
              <div className="text-body text-destructive">
                {report.collisions.length} collision
                {report.collisions.length === 1 ? "" : "s"} — nothing will be created
              </div>
              <ul className="mt-2 space-y-1.5 text-fine">
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
                        onClick={() => onJumpTo(colorwayAnchor(draftId, c.row.colorwayKey!))}
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
            <div className="border border-destructive/50 bg-destructive/5 p-4">
              <div className="text-body text-destructive">Not ready</div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-fine">
                {report.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {customsGaps.length ? (
            <div className="border border-ink bg-paper p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-body text-ink">
                  Customs incomplete — {customsGaps.length} of 6 missing
                </div>
                <button
                  type="button"
                  className="text-fine underline underline-offset-2"
                  onClick={() => onJumpTo(customsAnchor(draftId))}
                >
                  fill in
                </button>
              </div>
              <p className="mt-1 text-fine text-ink">
                Missing: {customsGaps.join(", ")}. The product can still be created, but
                Loom and Shopify will not have {customsGaps.length === 1 ? "it" : "them"} for
                shipping and duties until someone fills {customsGaps.length === 1 ? "it" : "them"}{" "}
                in on the product.
              </p>
            </div>
          ) : null}

          {report.warnings.length ? (
            <div className="border border-ink bg-paper p-4">
              <div className="text-body text-ink">
                Worth knowing
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-fine text-ink">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.ok ? (
            <div className="border border-line bg-paper p-3 text-body text-muted-foreground">
              Ready. {report.counts.styles ? "1 new style, " : "Existing style, "}
              {report.counts.colorways} colourways, {report.counts.variants} variants,{" "}
              {report.counts.prices} prices.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-body"
          onClick={() => setOpen((v) => !v)}
        >
          {item.created ? "What was created" : "Everything that will be created"}
          <span className="text-fine text-muted-foreground">{open ? "hide" : "show"}</span>
        </button>
        {open ? (
          <div className="space-y-3 border-t px-4 py-3 text-body">
            {payload.style ? (
              <div>
                <code className="font-mono text-fine">{payload.style.styleSku}</code>{" "}
                <span className="text-muted-foreground">{payload.style.styleName}</span>
              </div>
            ) : null}
            {payload.colorways.map((cw) => (
              <div key={cw.key} className="pl-4">
                <div>
                  <code className="font-mono text-fine">{cw.colorwaySku}</code>{" "}
                  <span className="text-muted-foreground">{cw.name}</span>
                  {cw.prices.MSRP ? (
                    <span className="ml-2 text-fine text-muted-foreground">
                      {cw.prices.COST ? `${cw.prices.COST} / ` : ""}
                      {cw.prices.MSRP} NOK
                    </span>
                  ) : null}
                  {cw.category ? (
                    <span
                      className="ml-2 rounded-full border px-2 py-0.5 text-fine text-muted-foreground"
                      title="This colourway's own category, not the batch's"
                    >
                      {cw.category}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 pl-4">
                  {cw.variants.map((v) => (
                    <span
                      key={v.key}
                      title={v.variantSku}
                      className={
                        " border px-1.5 py-0.5 font-mono text-fine " +
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
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-fine text-muted-foreground">{label}</div>
      <div className="truncate text-body">{value}</div>
      {sub ? <div className="text-fine text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
