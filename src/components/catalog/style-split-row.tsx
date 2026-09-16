"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { SplitProposal, SplitStyle } from "@/lib/master/style-splits";

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

const KIND_LABEL: Record<string, string> = {
  "duplicate-style": "two styles, one name",
  "self-named": "the colour is in the style name",
  promote: "no parent exists — promote one",
};

function Seasons({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="text-muted-foreground">no season</span>;
  return <span className="text-muted-foreground">{codes.join(", ")}</span>;
}

function TargetLine({ style, renameTo }: { style: SplitStyle; renameTo?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
      <Badge>keep</Badge>
      <span className="font-medium">
        {renameTo && renameTo !== style.styleName ? (
          <>
            <span className="text-muted-foreground line-through">{style.styleName}</span>
            {" → "}
            {renameTo}
          </>
        ) : (
          style.styleName
        )}
      </span>
      <code className="text-xs">{style.styleSku}</code>
      <span className="text-xs text-muted-foreground">
        {style.colorways.length} colourway{style.colorways.length === 1 ? "" : "s"}
      </span>
      {style.threadflowId ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">Threadflow</span>
      ) : (
        <span className="text-xs text-muted-foreground">{style.source}</span>
      )}
      <span className="text-xs text-muted-foreground">{style.category}</span>
      {style.inLoom ? <span className="text-xs text-muted-foreground">in Loom</span> : null}
    </div>
  );
}

export interface RowProps {
  proposal: SplitProposal;
  /** Pre-ticked for high confidence; everything else starts unchecked. */
  defaultChecked: boolean;
}

interface ApplyResponse {
  syncRunId?: string;
  colorwaysMoved?: number;
  colorwaysRenamed?: number;
  stylesRenamed?: number;
  emptied?: { styleSku: string; inLoom: boolean }[];
  warnings?: string[];
  styles?: { moves: { renameSkipped?: string }[] }[];
  error?: string;
}

interface VerifyRun {
  season: string;
  colorways: number;
  error?: string;
  result?: {
    ok: boolean;
    sent: number;
    requested: number;
    jobId?: string;
    job?: { status: string; created?: number; updated?: number; archived?: number; fatalError?: string };
    skipped?: { colorwayId: string; reason: string }[];
    preview?: { wouldSend: number; styles: number };
  };
}

interface VerifyResponse {
  ok?: boolean;
  dryRun?: boolean;
  seasons?: string[];
  runs?: VerifyRun[];
  skipped?: { colorwayId: string; reason: string }[];
  warnings?: string[];
  error?: string;
}

/** What happened, in words. The JSON is still there underneath for when it matters. */
function Outcome({
  applied,
  pushed,
  targetSku,
}: {
  applied: ApplyResponse | null;
  pushed: VerifyResponse | null;
  targetSku: string;
}) {
  if (!applied && !pushed) return null;

  const renameHeldBack =
    applied?.styles?.flatMap((s) => s.moves).filter((m) => m.renameSkipped).length ?? 0;
  const jobs = (pushed?.runs ?? []).filter((r) => r.result?.jobId);
  const pushFailed = pushed && pushed.ok === false;

  return (
    <div
      className={`mt-3 rounded-md border p-3 text-xs ${
        pushFailed
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-emerald-500/40 bg-emerald-500/5"
      }`}
    >
      {applied ? (
        <p>
          <strong className="text-foreground">Origio:</strong> moved{" "}
          {applied.colorwaysMoved ?? 0} colourway
          {applied.colorwaysMoved === 1 ? "" : "s"} into <code>{targetSku}</code>
          {applied.colorwaysRenamed ? `, renamed ${applied.colorwaysRenamed}` : ""}
          {applied.stylesRenamed ? `, renamed the style itself` : ""}.{" "}
          {applied.emptied?.length
            ? `${applied.emptied.length} style${applied.emptied.length === 1 ? "" : "s"} left empty.`
            : ""}
          {applied.syncRunId ? (
            <span className="text-muted-foreground"> Logged as {applied.syncRunId}.</span>
          ) : null}
        </p>
      ) : null}

      {renameHeldBack ? (
        <p className="mt-1 text-muted-foreground">
          {renameHeldBack} rename{renameHeldBack === 1 ? " was" : "s were"} held back
          because the row is live on Shopify/Sitoo. Tick the second box to carry
          those too — it changes the product title there.
        </p>
      ) : null}

      {pushed ? (
        pushed.dryRun ? (
          <p className="mt-1">
            <strong className="text-foreground">Loom (preview only):</strong> would
            send{" "}
            {(pushed.runs ?? []).reduce((n, r) => n + (r.result?.preview?.wouldSend ?? 0), 0)}{" "}
            colourways across {pushed.seasons?.join(", ")}. Nothing was transmitted.
          </p>
        ) : (
          <p className="mt-1">
            <strong className="text-foreground">Loom:</strong>{" "}
            {jobs.length ? (
              <>
                sent{" "}
                {(pushed.runs ?? []).reduce((n, r) => n + (r.result?.sent ?? 0), 0)}{" "}
                colourways in {jobs.length} deliver{jobs.length === 1 ? "y" : "ies"} (
                {jobs
                  .map(
                    (r) =>
                      `${r.season}: ${r.result?.job?.status ?? "sent"}` +
                      (r.result?.job
                        ? ` ${r.result.job.created ?? 0} created / ${r.result.job.updated ?? 0} updated`
                        : "")
                  )
                  .join("; ")}
                ).
              </>
            ) : (
              "nothing was accepted."
            )}
          </p>
        )
      ) : null}

      {(pushed?.runs ?? []).filter((r) => r.error || r.result?.job?.fatalError).map((r) => (
        <p key={r.season} className="mt-1 text-destructive">
          {r.season}: {r.error ?? r.result?.job?.fatalError}
        </p>
      ))}

      {(pushed?.warnings ?? []).map((w) => (
        <p key={w} className="mt-1 text-muted-foreground">
          {w}
        </p>
      ))}

      {applied && pushFailed ? (
        <p className="mt-2 text-muted-foreground">
          The Origio change is done and does not need repeating — only the push
          failed. Use <em>Send this style to Loom</em> to retry it on its own.
        </p>
      ) : null}
    </div>
  );
}

export function StyleSplitRow({ proposal: p, defaultChecked }: RowProps) {
  const allIds = useMemo(
    () => [
      ...p.absorb.flatMap((a) => a.colorways.map((c) => c.colorwayId)),
      ...(p.targetColorways ?? []).map((c) => c.colorwayId),
    ],
    [p]
  );
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(defaultChecked ? allIds : [])
  );
  // Two separate decisions. Stripping the garment name is the point of the fix
  // — "Riley Navy" under a style called Riley should be "Navy". Carrying that
  // onto a published row is not: the colourway name IS the Shopify product
  // title, so it needs saying out loud.
  const [rename, setRename] = useState(p.kind !== "duplicate-style");
  const [renamePublished, setRenamePublished] = useState(false);
  const [busy, setBusy] = useState<null | "preview" | "apply" | "check" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<ApplyResponse | null>(null);
  const [pushed, setPushed] = useState<VerifyResponse | null>(null);
  const [raw, setRaw] = useState<unknown>(null);

  const done = Boolean(applied && pushed && pushed.dryRun === false && pushed.ok);

  const publishedCount = useMemo(
    () =>
      [...p.absorb.flatMap((a) => a.colorways), ...(p.targetColorways ?? [])].filter(
        (c) =>
          chosen.has(c.colorwayId) &&
          c.publishedTo.some((ch) => ch === "SHOPIFY" || ch === "SITOO")
      ).length,
    [p, chosen]
  );

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selection = useCallback(() => {
    const byId = new Map(
      [
        ...p.absorb.flatMap((a) => a.colorways),
        ...(p.targetColorways ?? []),
      ].map((c) => [c.colorwayId, c] as const)
    );
    return {
      targetStyleId: p.target.styleId,
      targetRename: p.targetRename,
      moves: [...chosen].map((id) => ({
        colorwayId: id,
        ...(rename ? { newName: byId.get(id)?.proposedName } : {}),
      })),
    };
  }, [p, chosen, rename]);

  const postApply = useCallback(
    async (dryRun: boolean): Promise<ApplyResponse | null> => {
      const res = await fetch("/api/catalog/style-splits/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [selection()],
          dryRun,
          renamePublished: rename && renamePublished,
        }),
      });
      const body = (await res.json()) as ApplyResponse;
      setRaw(body);
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return null;
      }
      return body;
    },
    [selection, rename, renamePublished]
  );

  const postPush = useCallback(async (dryRun: boolean): Promise<VerifyResponse | null> => {
    const res = await fetch("/api/catalog/style-splits/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styleIds: [p.target.styleId], dryRun }),
    });
    const body = (await res.json()) as VerifyResponse;
    setRaw(body);
    if (!res.ok) {
      setError(body?.error ?? `HTTP ${res.status}`);
      return null;
    }
    return body;
  }, [p.target.styleId]);

  /** Dry run of the Origio change only — nothing is written, nothing is sent. */
  const preview = useCallback(async () => {
    setBusy("preview");
    setError(null);
    try {
      await postApply(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [postApply]);

  /**
   * The whole job for one style: re-nest it here, then send the corrected
   * grouping to Loom.
   *
   * Sequenced rather than combined on the server, and deliberately: if the push
   * fails the Origio change still stands and must not be repeated, so the two
   * outcomes are reported separately.
   */
  const applyAndPush = useCallback(
    async (push: boolean) => {
      setBusy("apply");
      setError(null);
      setApplied(null);
      setPushed(null);
      try {
        const a = await postApply(false);
        if (!a) return;
        setApplied(a);
        if (!push) return;
        setBusy("send");
        setPushed(await postPush(false));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [postApply, postPush]
  );

  const verifyOnly = useCallback(
    async (dryRun: boolean) => {
      setBusy(dryRun ? "check" : "send");
      setError(null);
      try {
        setPushed(await postPush(dryRun));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [postPush]
  );

  // Recording a rejection is what stops the same row coming back next run.
  //
  // Keyed on the styleSku, never the styleName: in a duplicate-style pair both
  // rows carry the same name, so a name key would reject the survivor too.
  const keepSeparate = useCallback(async (styleSku: string) => {
    setError(null);
    try {
      const res = await fetch("/api/catalog/style-splits/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: styleSku,
          kind: "KEEP_SEPARATE",
          note: "rejected in the style-splits review",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Silently losing this is the worst outcome: the row looks handled and
        // comes straight back on the next run.
        setError(body?.error ?? `Could not save the rejection (HTTP ${res.status}).`);
        return;
      }
      setDismissed((prev) => new Set(prev).add(styleSku));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const confirmText =
    `Apply this in Origio and push ${p.target.styleSku} to PRODUCTION Loom?\n\n` +
    `• ${chosen.size} colourway(s) move under ${p.targetRename ?? p.target.styleName}\n` +
    `• every colourway of that style is then sent, one delivery per season\n` +
    `• no colorway_id changes, so nothing loses its history\n\n` +
    `This is a real write to Loom.`;

  return (
    <div className={`rounded-lg border p-4 ${done ? "border-emerald-500/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.targetRename ?? p.target.styleName}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CONFIDENCE_STYLE[p.confidence]}`}
            >
              {p.confidence}
            </span>
            <span className="text-[11px] text-muted-foreground">{KIND_LABEL[p.kind]}</span>
            {done ? (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                done — applied and pushed
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{p.reason}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!!busy} onClick={preview}>
            {busy === "preview" ? "Checking…" : "Dry run"}
          </Button>
          <Button
            size="sm"
            disabled={!!busy || !chosen.size || p.blockers.length > 0}
            onClick={() => {
              if (window.confirm(confirmText)) applyAndPush(true);
            }}
          >
            {busy === "apply"
              ? "Applying…"
              : busy === "send"
                ? "Pushing…"
                : `Apply ${chosen.size} & push to Loom`}
          </Button>
        </div>
      </div>

      <Outcome applied={applied} pushed={pushed} targetSku={p.target.styleSku} />

      <div className="mt-3">
        <TargetLine style={p.target} renameTo={p.targetRename} />
        {rename && p.targetColorways?.length ? (
          <div className="mt-1.5 space-y-1 rounded-md border border-dashed px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              The promoted style&rsquo;s own colourways need the same strip, or it
              reads &ldquo;{p.targetColorways[0].name}&rdquo; beside &ldquo;
              {p.absorb[0]?.colorways[0]?.proposedName ?? "Navy"}&rdquo;.
            </p>
            {p.targetColorways.map((c) => (
              <label key={c.colorwayId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <Checkbox
                  checked={chosen.has(c.colorwayId)}
                  onCheckedChange={() => toggle(c.colorwayId)}
                />
                <code>{c.colorwaySku}</code>
                <span>
                  {c.name}
                  <span className="text-muted-foreground"> → {c.proposedName}</span>
                </span>
                {c.publishedTo.length ? (
                  <span className="text-muted-foreground">{c.publishedTo.join(", ")}</span>
                ) : null}
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-2 space-y-2">
        {p.absorb.map((a) => (
          <div
            key={a.styleId}
            className={`rounded-md border px-3 py-2 ${dismissed.has(a.styleSku) ? "opacity-40" : ""}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <Badge variant="outline">move out of</Badge>
              <span>{a.styleName}</span>
              <code className="text-xs">{a.styleSku}</code>
              <span className="text-xs text-muted-foreground">{a.source}</span>
              {a.brand ? <span className="text-xs text-muted-foreground">{a.brand}</span> : null}
              <span className="text-xs text-muted-foreground">{a.category}</span>
              <button
                type="button"
                className="ml-auto text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground"
                onClick={() => keepSeparate(a.styleSku)}
              >
                not this one
              </button>
            </div>
            <div className="mt-1.5 space-y-1">
              {a.colorways.map((c) => (
                <label
                  key={c.colorwayId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                >
                  <Checkbox
                    checked={chosen.has(c.colorwayId)}
                    onCheckedChange={() => toggle(c.colorwayId)}
                  />
                  <code>{c.colorwaySku}</code>
                  <span>
                    {c.name}
                    {rename && c.proposedName !== c.name ? (
                      <span className="text-muted-foreground"> → {c.proposedName}</span>
                    ) : null}
                  </span>
                  <Seasons codes={c.seasons} />
                  {c.archived ? <span className="text-muted-foreground">archived</span> : null}
                  {c.threadflowId ? (
                    <span className="text-amber-600 dark:text-amber-400">Threadflow</span>
                  ) : null}
                  {c.publishedTo.length ? (
                    <span className="text-muted-foreground">{c.publishedTo.join(", ")}</span>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2">
          <Checkbox checked={rename} onCheckedChange={(v) => setRename(Boolean(v))} />
          Strip the garment name from the colourway names
        </label>
        {rename && publishedCount > 0 ? (
          <label className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <Checkbox
              checked={renamePublished}
              onCheckedChange={(v) => setRenamePublished(Boolean(v))}
            />
            …including {publishedCount} row{publishedCount === 1 ? "" : "s"} live on
            Shopify/Sitoo — this changes the product title there
          </label>
        ) : null}
        <span className="text-muted-foreground">
          {p.absorb.length} style{p.absorb.length === 1 ? "" : "s"} left empty
          {p.absorb.some((a) => a.inLoom) ? " — some are in Loom" : ""}
        </span>
      </div>

      {p.categoryConflict ? (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          Categories disagree: {p.categoryConflict}. Loom takes category at style
          level, so whichever survives becomes the category for all of them.
        </p>
      ) : null}

      {p.blockers.map((b) => (
        <p
          key={b}
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
        >
          {b}
        </p>
      ))}

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-[11px] text-muted-foreground">
          Loom on its own, when the Origio change is already made:
        </span>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => verifyOnly(true)}>
          {busy === "check" ? "Building…" : "Preview payload"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy}
          onClick={() => {
            if (
              window.confirm(
                `Send ${p.target.styleSku} to PRODUCTION Loom now?\n\n` +
                  "Every colourway of this style, one delivery per season, mode " +
                  "\"data\". Nothing in Origio changes."
              )
            )
              verifyOnly(false);
          }}
        >
          {busy === "send" ? "Sending…" : "Push to Loom"}
        </Button>
      </div>

      {raw ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Raw response
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
