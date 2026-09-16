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
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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

  const send = useCallback(
    async (dryRun: boolean) => {
      setBusy(dryRun ? "preview" : "apply");
      setError(null);
      try {
        const res = await fetch("/api/catalog/style-splits/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selections: [selection()],
            dryRun,
            renamePublished: rename && renamePublished,
          }),
        });
        const body = await res.json();
        if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`);
        setResult(body);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [selection, rename, renamePublished]
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

  return (
    <div className="rounded-lg border p-4">
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
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{p.reason}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => send(true)}>
            {busy === "preview" ? "Previewing…" : "Preview"}
          </Button>
          <Button
            size="sm"
            disabled={!!busy || !chosen.size || p.blockers.length > 0}
            onClick={() => send(false)}
          >
            {busy === "apply" ? "Applying…" : `Apply ${chosen.size}`}
          </Button>
        </div>
      </div>

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
      {result ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
