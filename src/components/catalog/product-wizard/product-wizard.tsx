"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DRAFT_STEPS,
  emptyDraftPayload,
  type DraftStep,
  type DraftPayloadV1,
} from "@/lib/master/draft-payload";
import type { PreflightReport } from "@/lib/master/finalize";
import { useDraftAutosave, type SaveState } from "./use-draft-autosave";
import { StepBrand, fetchBrandDefaults } from "./step-brand";
import { StepBuild } from "./step-build";
import { StepReview, type ReviewItem } from "./step-review";
import {
  SiblingStyle,
  StyleBlock,
  styleAnchor,
  type SharedChoices,
  type StyleMember,
  type StyleReport,
} from "./style-section";
import type { WizardOptions } from "./types";

const STEP_LABELS: Record<DraftStep, string> = {
  brand: "Brand & season",
  build: "Style, colourways, sizes & prices",
  review: "Review",
};

interface BatchRow {
  id: string;
  ok: boolean;
  created: boolean;
  error: string | null;
  report: PreflightReport | null;
}

/**
 * The hand builder. One page holds one or more styles; each style is its own
 * draft (the first is this page's, the rest are grouped under it), so create,
 * resume and publish keep working per style, exactly as they did for one.
 */
export function ProductWizard({
  draftId,
  initialPayload,
  initialRevision,
  initialStep,
  initialSiblings,
  options,
}: {
  draftId: string;
  initialPayload: DraftPayloadV1;
  initialRevision: number;
  initialStep: DraftStep;
  initialSiblings: StyleMember[];
  options: WizardOptions;
}) {
  const router = useRouter();
  const { payload, update, step, goToStep, state, save, revision } = useDraftAutosave(
    draftId,
    initialPayload,
    initialRevision,
    initialStep
  );
  const [members, setMembers] = useState<StyleMember[]>(initialSiblings);
  const [created, setCreated] = useState<Set<string>>(
    () => new Set(initialSiblings.filter((m) => m.status === "COMPLETED").map((m) => m.id))
  );
  const [reports, setReports] = useState<Record<string, PreflightReport | null>>({});
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  // What each other style last reported. Held in a ref so a keystroke in one
  // style does not rebuild the others; the counter re-renders this page so the
  // rail, the save label and Review see the change.
  const siblingReports = useRef<Record<string, StyleReport>>({});
  const [, setTick] = useState(0);
  const onReport = useCallback((id: string, r: StyleReport) => {
    siblingReports.current[id] = r;
    setTick((t) => t + 1);
  }, []);

  const shared: SharedChoices = useMemo(
    () => ({
      brand: payload.brand,
      seasonId: payload.seasonId,
      channels: payload.channels,
      kind: payload.kind,
    }),
    [payload.brand, payload.seasonId, payload.channels, payload.kind]
  );

  // Created and interrupted styles are not editable here: a created one is in
  // the master, and an interrupted one is finished by pressing Create again.
  const editable = (m: StyleMember) => !created.has(m.id) && m.status === "DRAFT";
  const payloadOf = (m: StyleMember) => siblingReports.current[m.id]?.payload ?? m.payload;
  const all: { id: string; payload: DraftPayloadV1 }[] = [
    { id: draftId, payload },
    ...members.map((m) => ({ id: m.id, payload: payloadOf(m) })),
  ];

  const saveAll = useCallback(async () => {
    const results = await Promise.all([
      save(),
      ...members
        .filter((m) => !created.has(m.id) && m.status === "DRAFT")
        .map((m) => siblingReports.current[m.id]?.save() ?? Promise.resolve(true)),
    ]);
    return results.every(Boolean);
  }, [save, members, created]);

  // Pre-flight runs server-side against the SAVED drafts, so the check and the
  // create see the same bytes — a client-side copy could drift from what is
  // about to be written.
  const check = useCallback(async () => {
    setChecking(true);
    try {
      await saveAll();
      const ids = [draftId, ...members.map((m) => m.id)].filter((id) => !created.has(id));
      const res = await fetch("/api/catalog/drafts/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "check" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not check");
      const rows = json.rows as BatchRow[];
      setReports(Object.fromEntries(rows.map((r) => [r.id, r.report])));
      for (const r of rows) if (r.error) toast.error(r.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not check");
    } finally {
      setChecking(false);
    }
  }, [draftId, members, created, saveAll]);

  async function create() {
    setCreating(true);
    try {
      if (!(await saveAll())) return;
      // The first style last, so that if one of the others fails this page's
      // own draft is still open and the failed style can be fixed here.
      const ids = [...members.map((m) => m.id), draftId].filter((id) => !created.has(id));
      const res = await fetch("/api/catalog/drafts/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action: "create" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create");
      const rows = json.rows as BatchRow[];
      const nowCreated = new Set(created);
      for (const r of rows) if (r.created) nowCreated.add(r.id);
      setCreated(nowCreated);
      setReports((prev) => ({
        ...prev,
        ...Object.fromEntries(rows.filter((r) => !r.created).map((r) => [r.id, r.report])),
      }));
      for (const r of rows) if (r.error) toast.error(r.error);

      const everyone = [draftId, ...members.map((m) => m.id)];
      if (everyone.every((id) => nowCreated.has(id))) {
        toast.success(
          everyone.length === 1 ? "Created the product." : `Created ${everyone.length} styles.`
        );
        router.push(`/catalog/products/drafts/${draftId}/done`);
        router.refresh();
        return;
      }
      const made = rows.filter((r) => r.created).length;
      toast.error(
        made
          ? `Created ${made} of ${rows.length} styles — see the review for the rest.`
          : "Not created — see the review panel."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    } finally {
      setCreating(false);
    }
  }

  async function discard() {
    const others = members.filter((m) => !created.has(m.id)).length;
    const what = others
      ? `Discard this build and its ${others} other style${others === 1 ? "" : "s"}?`
      : "Discard this draft?";
    if (!confirm(`${what} Nothing has been created yet.`)) return;
    await fetch(`/api/catalog/drafts/${draftId}`, { method: "DELETE" });
    router.push("/catalog/products/drafts");
    router.refresh();
  }

  async function addStyle() {
    setAdding(true);
    try {
      // The brand's defaults, as the first style got them; never the first
      // style's own customs, which describe a different garment.
      let template = emptyDraftPayload().template;
      if (payload.brand.id) {
        try {
          const d = await fetchBrandDefaults(payload.brand.id);
          if (d) template = { ...template, ...d.fill, unisex: d.unisex };
        } catch {
          // Typed by hand instead; not worth refusing the style over.
        }
      }
      const res = await fetch(`/api/catalog/drafts/${draftId}/styles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not add a style");
      const d = json.draft as StyleMember;
      setMembers((ms) => [
        ...ms,
        { id: d.id, payload: d.payload, revision: d.revision, status: d.status },
      ]);
      setTimeout(
        () => document.getElementById(styleAnchor(d.id))?.scrollIntoView({ block: "start" }),
        50
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add a style");
    } finally {
      setAdding(false);
    }
  }

  async function removeStyle(id: string) {
    const p = members.find((m) => m.id === id);
    const name = p ? payloadOf(p).style?.styleName : null;
    if (!confirm(`Remove ${name ? `“${name}”` : "this style"} from the build?`)) return;
    const res = await fetch(`/api/catalog/drafts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "Could not remove the style");
      return;
    }
    delete siblingReports.current[id];
    setMembers((ms) => ms.filter((m) => m.id !== id));
  }

  // The brand is the one shared choice that cannot simply follow: a style's
  // SKU carries the brand's token and an existing style belongs to one brand.
  // So changing it clears the first style (as it always has) and removes the
  // others, after asking.
  function beforeBrandChange(): boolean {
    const others = members.filter((m) => !created.has(m.id));
    if (!others.length) return true;
    if (
      !confirm(
        `Changing the brand removes the other ${others.length} style${
          others.length === 1 ? "" : "s"
        } in this build, with their colourways, sizes and prices. Continue?`
      )
    )
      return false;
    for (const m of others) {
      void fetch(`/api/catalog/drafts/${m.id}`, { method: "DELETE" });
      delete siblingReports.current[m.id];
    }
    setMembers((ms) => ms.filter((m) => created.has(m.id)));
    return true;
  }

  const groupErrors = clashesBetween(all);
  const done = completedSteps(
    payload,
    members.filter(editable).map((m) => payloadOf(m))
  );
  const saveState = worst([
    state,
    ...members.map((m) => siblingReports.current[m.id]?.state ?? { kind: "clean" as const }),
  ]);
  const total = 1 + members.length;

  const reviewItems: ReviewItem[] = all.map((x) => ({
    draftId: x.id,
    payload: x.payload,
    report: reports[x.id] ?? null,
    created: created.has(x.id),
  }));

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
              onClick={() => {
                goToStep(s);
                if (s === "review") void check();
              }}
              className={
                " border px-2.5 py-1 text-fine transition-colors " +
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
        <span className="ml-auto text-fine text-muted-foreground">{saveLabel(saveState)}</span>
      </nav>

      <div className="min-h-[18rem]">
        {step === "brand" ? (
          <StepBrand
            payload={payload}
            update={update}
            options={options}
            beforeBrandChange={beforeBrandChange}
          />
        ) : null}

        {/* Every style stays mounted on every step, so a save still waiting on
            its idle timer is not lost by moving to Review. */}
        <div hidden={step !== "build"} className="space-y-4">
          {step === "build" ? (
            <StyleBlock draftId={draftId} index={0} total={total} payload={payload}>
              <StepBuild
                payload={payload}
                update={update}
                options={options}
                draftId={draftId}
                revisionRef={revision}
                onImported={(p, rev) => {
                  revision.current = rev;
                  update(p);
                }}
              />
            </StyleBlock>
          ) : null}

          {members.map((m, i) =>
            editable(m) ? (
              <SiblingStyle
                key={m.id}
                member={m}
                index={i + 1}
                total={total}
                shared={shared}
                options={options}
                visible={step === "build"}
                onReport={onReport}
                onRemove={() => void removeStyle(m.id)}
              />
            ) : step === "build" ? (
              <StyleBlock
                key={m.id}
                draftId={m.id}
                index={i + 1}
                total={total}
                payload={m.payload}
                note={created.has(m.id) ? "created" : "interrupted — Create finishes it"}
              >
                <p className="text-body text-muted-foreground">
                  {created.has(m.id)
                    ? "This style is in the master and can no longer be edited here."
                    : "Creating this style was interrupted. Pressing Create on Review finishes it with the ids it already reserved."}
                </p>
              </StyleBlock>
            ) : null
          )}

          {step === "build" && payload.brand.id ? (
            <div className="flex items-center gap-3 border border-dashed p-4">
              <Button variant="outline" size="sm" disabled={adding} onClick={addStyle}>
                {adding ? "Adding…" : "+ Another style"}
              </Button>
              <span className="text-fine text-muted-foreground">
                Same brand, season and channels. Each style gets its own colourways, sizes,
                prices and customs.
              </span>
            </div>
          ) : null}
        </div>

        {step === "review" ? (
          <StepReview
            items={reviewItems}
            channels={payload.channels}
            groupErrors={groupErrors}
            options={options}
            checking={checking}
            onCheck={check}
            onCreate={create}
            creating={creating}
            onJumpTo={(anchor) => {
              goToStep("build");
              // After the builder has rendered: open the style if someone
              // collapsed it, then bring the card into view.
              setTimeout(() => {
                const el = document.getElementById(anchor);
                el?.closest("details")?.setAttribute("open", "");
                el?.scrollIntoView({ block: "start" });
              }, 50);
            }}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="outline" size="sm" onClick={discard}>
          {members.length ? "Discard build" : "Discard draft"}
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

function styleComplete(p: DraftPayloadV1): boolean {
  return Boolean(
    p.style &&
      p.colorways.length &&
      p.colorways.every((c) => c.name.trim() && c.variants.length && c.prices.MSRP)
  );
}

/**
 * Which steps have enough in them to move past. A rail, not a gate: Next always
 * moves on, and Review says itself what is still missing. Barcodes and customs
 * are optional, so they do not hold up the tick.
 */
function completedSteps(p: DraftPayloadV1, others: DraftPayloadV1[]): Set<DraftStep> {
  const done = new Set<DraftStep>();
  if (p.brand.id && p.seasonId && p.channels.length) done.add("brand");
  if (styleComplete(p) && others.every(styleComplete)) done.add("build");
  return done;
}

/**
 * SKUs two styles of this build would both create. Each draft's pre-flight
 * checks the master, not the other drafts beside it, so two styles can each
 * pass and then collide on create; this is the check between them.
 */
function clashesBetween(all: { id: string; payload: DraftPayloadV1 }[]): string[] {
  const out: string[] = [];
  const styleSkus = new Map<string, number>();
  const colorwaySkus = new Map<string, Set<string>>();
  for (const { id, payload } of all) {
    if (payload.style?.mode === "new" && payload.style.styleSku)
      styleSkus.set(payload.style.styleSku, (styleSkus.get(payload.style.styleSku) ?? 0) + 1);
    for (const cw of payload.colorways) {
      if (!cw.colorwaySku) continue;
      const s = colorwaySkus.get(cw.colorwaySku) ?? new Set<string>();
      s.add(id);
      colorwaySkus.set(cw.colorwaySku, s);
    }
  }
  for (const [sku, n] of styleSkus)
    if (n > 1) out.push(`${n} styles would all be created as ${sku}. Give each its own name.`);
  for (const [sku, ids] of colorwaySkus)
    if (ids.size > 1) out.push(`${sku} is a colourway in ${ids.size} styles of this build.`);
  return out;
}

/** The save state worth showing for the whole build: the worst of them. */
function worst(states: SaveState[]): SaveState {
  const order: SaveState["kind"][] = ["conflict", "error", "saving", "dirty", "clean"];
  for (const k of order) {
    const s = states.find((x) => x.kind === k);
    if (s) return s;
  }
  return { kind: "clean" };
}

function saveLabel(state: SaveState): string {
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
