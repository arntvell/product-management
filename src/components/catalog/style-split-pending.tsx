"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface PendingStyle {
  styleId: string;
  styleSku: string;
  styleName: string;
  appliedAt: string;
  colorways: number;
  notPushed: number;
  seasons: string[];
  examples: string[];
}

/**
 * Styles re-nested here that Loom has not been told about.
 *
 * Worth its own panel rather than a column on a row, because once an apply
 * lands the proposal disappears from the report — the work is invisible from
 * that moment until someone remembers it. This is the only place a half-finished
 * repair shows up.
 */
export function StyleSplitPending() {
  const [pending, setPending] = useState<PendingStyle[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog/style-splits/pending");
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setPending(body.pending ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const push = useCallback(
    async (s: PendingStyle) => {
      if (
        !window.confirm(
          `Send ${s.styleSku} to PRODUCTION Loom?\n\n` +
            `${s.colorways} colourways, one delivery per season ` +
            `(${s.seasons.join(", ")}). This is what tells Loom about the ` +
            `re-nesting already applied here.`
        )
      )
        return;
      setBusy(s.styleId);
      setError(null);
      setNote(null);
      try {
        const res = await fetch("/api/catalog/style-splits/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleIds: [s.styleId], dryRun: false }),
        });
        const body = await res.json();
        if (!res.ok || body.ok === false) {
          setError(body?.error ?? `${s.styleSku}: Loom did not accept the push.`);
        } else {
          const sent = (body.runs ?? []).reduce(
            (n: number, r: { result?: { sent?: number } }) => n + (r.result?.sent ?? 0),
            0
          );
          setNote(`${s.styleSku}: sent ${sent} colourways across ${body.seasons?.join(", ")}.`);
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  if (!pending?.length) return null;

  return (
    <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <h2 className="text-sm font-semibold">
        Applied here, not yet in Loom — {pending.length}
      </h2>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        The colourways have moved in Origio, so the proposal is gone from the list
        below. Loom still holds the old grouping until these are pushed.
      </p>
      <div className="mt-3 space-y-2">
        {pending.map((s) => (
          <div
            key={s.styleId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
          >
            <div className="min-w-0 text-sm">
              <span className="font-medium">{s.styleName}</span>{" "}
              <code className="text-xs">{s.styleSku}</code>
              <div className="text-xs text-muted-foreground">
                {s.notPushed} of {s.colorways} colourways unsent · {s.seasons.join(", ")} ·
                applied {new Date(s.appliedAt).toLocaleString("en-GB")}
              </div>
            </div>
            <Button size="sm" disabled={!!busy} onClick={() => push(s)}>
              {busy === s.styleId ? "Pushing…" : "Push to Loom"}
            </Button>
          </div>
        ))}
      </div>
      {note ? <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{note}</p> : null}
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
