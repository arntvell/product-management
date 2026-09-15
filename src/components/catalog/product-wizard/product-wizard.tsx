"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DRAFT_STEPS, type DraftStep, type DraftPayloadV1 } from "@/lib/master/draft-payload";
import type { PreflightReport } from "@/lib/master/finalize";
import { useDraftAutosave } from "./use-draft-autosave";
import { StepBrand } from "./step-brand";
import { StepStyle } from "./step-style";
import { StepColorways } from "./step-colorways";
import { StepSizes } from "./step-sizes";
import { StepPrices } from "./step-prices";
import { StepBarcodes } from "./step-barcodes";
import { StepReview } from "./step-review";
import type { WizardOptions } from "./types";

const STEP_LABELS: Record<DraftStep, string> = {
  brand: "Brand & season",
  style: "Style",
  colorways: "Colourways",
  sizes: "Sizes",
  prices: "Prices",
  barcodes: "Barcodes",
  review: "Review",
};

export function ProductWizard({
  draftId,
  initialPayload,
  initialRevision,
  initialStep,
  options,
}: {
  draftId: string;
  initialPayload: DraftPayloadV1;
  initialRevision: number;
  initialStep: DraftStep;
  options: WizardOptions;
}) {
  const router = useRouter();
  const { payload, update, step, goToStep, state, save, revision } = useDraftAutosave(
    draftId,
    initialPayload,
    initialRevision,
    initialStep
  );
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);

  // Pre-flight runs server-side against the SAVED draft, so the check and the
  // create see the same bytes — a client-side copy could drift from what is
  // about to be written.
  const check = useCallback(async () => {
    setChecking(true);
    try {
      await save();
      const res = await fetch(`/api/catalog/drafts/${draftId}/preflight`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not check");
      setReport(json.report);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check");
    } finally {
      setChecking(false);
    }
  }, [draftId, save]);

  async function create() {
    setCreating(true);
    try {
      if (!(await save())) return;
      const res = await fetch(`/api/catalog/drafts/${draftId}/finalize`, { method: "POST" });
      const json = await res.json();
      if (res.status === 422 && json.report) {
        setReport(json.report);
        toast.error("Not created — see the review panel.");
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Could not create");
      toast.success(
        `Created ${json.result.colorwayIds.length} colourway(s), ${json.result.variantCount} variants.`
      );
      router.push(`/catalog/products/drafts/${draftId}/done`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    } finally {
      setCreating(false);
    }
  }

  async function discard() {
    if (!confirm("Discard this draft? Nothing has been created yet.")) return;
    await fetch(`/api/catalog/drafts/${draftId}`, { method: "DELETE" });
    router.push("/catalog/products/drafts");
    router.refresh();
  }

  const done = completedSteps(payload);

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-1.5">
        {DRAFT_STEPS.map((s, i) => {
          const reachable = i === 0 || done.has(DRAFT_STEPS[i - 1]);
          const active = s === step;
          return (
            <button
              key={s}
              type="button"
              disabled={!reachable && !active}
              onClick={() => goToStep(s)}
              className={
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-foreground bg-foreground text-background"
                  : reachable
                    ? "hover:bg-muted"
                    : "opacity-40")
              }
            >
              {i + 1}. {STEP_LABELS[s]}
              {done.has(s) && !active ? " ✓" : ""}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-muted-foreground">{saveLabel(state)}</span>
      </nav>

      <div className="min-h-[18rem]">
        {step === "brand" ? <StepBrand payload={payload} update={update} options={options} /> : null}
        {step === "style" ? <StepStyle payload={payload} update={update} options={options} /> : null}
        {step === "colorways" ? (
          <StepColorways payload={payload} update={update} options={options} />
        ) : null}
        {step === "sizes" ? <StepSizes payload={payload} update={update} options={options} /> : null}
        {step === "prices" ? (
          <StepPrices payload={payload} update={update} options={options} />
        ) : null}
        {step === "barcodes" ? (
          <StepBarcodes
            payload={payload}
            update={update}
            options={options}
            draftId={draftId}
            revision={revision.current}
            onImported={(p, rev) => {
              revision.current = rev;
              update(p);
            }}
          />
        ) : null}
        {step === "review" ? (
          <StepReview
            payload={payload}
            update={update}
            options={options}
            report={report}
            checking={checking}
            onCheck={check}
            onCreate={create}
            creating={creating}
            onJumpTo={goToStep}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="outline" size="sm" onClick={discard}>
          Discard draft
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={step === DRAFT_STEPS[0]}
            onClick={() => goToStep(DRAFT_STEPS[DRAFT_STEPS.indexOf(step) - 1])}
          >
            Back
          </Button>
          <Button
            size="sm"
            disabled={step === "review"}
            onClick={() => {
              const next = DRAFT_STEPS[DRAFT_STEPS.indexOf(step) + 1];
              goToStep(next);
              if (next === "review") void check();
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Which steps have enough in them to move past. A rail, not a gate. */
function completedSteps(p: DraftPayloadV1): Set<DraftStep> {
  const done = new Set<DraftStep>();
  if (p.brand.id && p.seasonId && p.channels.length) done.add("brand");
  if (p.style) done.add("style");
  if (p.colorways.length && p.colorways.every((c) => c.name.trim())) done.add("colorways");
  if (p.colorways.length && p.colorways.every((c) => c.variants.length)) done.add("sizes");
  if (p.colorways.every((c) => c.prices.MSRP)) done.add("prices");
  done.add("barcodes"); // optional by design
  return done;
}

function saveLabel(state: ReturnType<typeof useDraftAutosave>["state"]): string {
  switch (state.kind) {
    case "clean":
      return "Saved";
    case "dirty":
      return "Saving shortly…";
    case "saving":
      return "Saving…";
    case "conflict":
      return "Saved elsewhere — reload";
    case "error":
      return "Not saved";
  }
}
