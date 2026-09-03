"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "full" | "no-images";

interface ColorwaySide {
  id: string;
  colorwaySku: string;
  name: string;
  source: string;
  variantCount: number;
  withBarcodes: number;
  seasons: string[];
  channels: string[];
  styleSku: string;
}

interface SkippedItem {
  kind: string;
  seasonCode: string;
  styleSku: string;
  incoming: { colorwaySku: string; colorwayId: string; name: string; variantCount: number };
  local: ColorwaySide | null;
  blocker: ColorwaySide | null;
  message: string;
  suggestion: string;
}

interface SyncOutcome {
  dryRun: boolean;
  status?: "ok" | "partial" | "failed";
  seasonCode: string;
  counts?: Record<string, number>;
  planned?: Record<string, number>;
  renames: { from: string; to: string }[];
  repoints: { reason: string }[];
  skipped: SkippedItem[];
  warnings: string[];
  errors?: string[];
  durationMs: number;
}

interface RunRow {
  id: string;
  source: string;
  mode: string;
  seasonCode: string | null;
  startedAt: string;
  status: string;
  counts: Record<string, number> | null;
  errors: string[] | null;
  warnings: string[] | null;
  skipped: SkippedItem[] | null;
}

function statusLabel(o: SyncOutcome): string {
  if (o.dryRun) return "Preview — nothing was written";
  if (o.status === "ok") return "✓ Sync complete";
  if (o.status === "partial") return "✓ Sync complete, some items skipped";
  return "⚠ Sync failed";
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "ok"
      ? "secondary"
      : status === "partial"
        ? "outline"
        : status === "running"
          ? "ghost"
          : "destructive";
  return <Badge variant={variant}>{status}</Badge>;
}

function sideLabel(s: ColorwaySide | null): string {
  if (!s) return "—";
  const bits = [
    s.source,
    `${s.variantCount} sizes`,
    s.withBarcodes ? `${s.withBarcodes} barcodes` : null,
    s.seasons.length ? s.seasons.join("+") : null,
    s.channels.length ? `on ${s.channels.join("+")}` : null,
  ].filter(Boolean);
  return `${s.colorwaySku} (${bits.join(", ")})`;
}

/** Conflicts and skips, as a table you can act on. */
function SkippedTable({ items }: { items: SkippedItem[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Season · style</th>
            <th className="py-1 pr-3 font-medium">Wanted SKU</th>
            <th className="py-1 pr-3 font-medium">Our row</th>
            <th className="py-1 pr-3 font-medium">Held by</th>
            <th className="py-1 font-medium">What to do</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s, i) => (
            <Fragment key={i}>
              <tr className="align-top">
                <td className="pt-2 pr-3 whitespace-nowrap">
                  {s.seasonCode} · {s.styleSku}
                </td>
                <td className="pt-2 pr-3 font-mono">{s.incoming.colorwaySku}</td>
                <td className="pt-2 pr-3">{sideLabel(s.local)}</td>
                <td className="pt-2 pr-3">{sideLabel(s.blocker)}</td>
                <td className="pt-2">{s.suggestion}</td>
              </tr>
              {/* The prose line carries the detail the columns can't: what was
                  written anyway, and why nothing moved. */}
              <tr className="border-b last:border-0">
                <td colSpan={5} className="pb-2 text-muted-foreground">
                  {s.message}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Warnings and errors both get this: first five, then the rest on request. */
function NoteList({
  items,
  tone,
}: {
  items: string[];
  tone: "warning" | "error";
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 5);
  return (
    <div className="mt-2">
      <ul
        className={`list-disc space-y-0.5 pl-4 text-xs ${
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {shown.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      {items.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs underline text-muted-foreground"
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

export function SyncPanel({ defaultSeason = "SS27" }: { defaultSeason?: string }) {
  const router = useRouter();
  const [season, setSeason] = useState(defaultSeason);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog/sync?take=10");
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      // The history is a convenience; never let it break the panel.
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function run(mode: Mode, dryRun: boolean) {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonCode: season.trim(), mode, dryRun }),
      });
      const data = await res.json();
      if (!res.ok && !data.counts && !data.planned) {
        setError(data.error ?? `Sync failed (${res.status})`);
      } else {
        setResult(data);
        if (!dryRun) {
          router.refresh(); // re-fetch server component counts
          void loadRuns();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync request failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-lg border p-5">
      <h2 className="text-sm font-semibold">Sync from Threadflow</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pull a season&apos;s Livid catalogue (including not-yet-approved and
        dropped colorways) into the master. Safe to re-run — matches on stable
        ids, keeps barcodes, never deletes. A product whose SKU collides with
        another record is skipped and listed rather than failing the run.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          placeholder="Season code (e.g. SS27)"
          className="w-44"
          disabled={running}
        />
        <Button onClick={() => run("full", false)} disabled={running || !season.trim()}>
          {running ? "Working…" : "Sync season"}
        </Button>
        <Button
          variant="outline"
          onClick={() => run("no-images", false)}
          disabled={running || !season.trim()}
        >
          Without images
        </Button>
        <Button
          variant="ghost"
          onClick={() => run("full", true)}
          disabled={running || !season.trim()}
        >
          Preview
        </Button>
      </div>

      {running && (
        <p className="mt-3 text-xs text-muted-foreground">
          Walking the season — this can take a minute or two from a local
          machine (the database is remote). You can leave this open.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            {statusLabel(result)}
            <span className="ml-2 font-normal text-muted-foreground">
              {result.seasonCode} · {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {Object.entries(result.counts ?? result.planned ?? {}).map(([k, v]) => (
              <span key={k}>
                {v} {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </span>
            ))}
          </div>

          {result.errors && result.errors.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium text-destructive">
                Errors ({result.errors.length})
              </p>
              <NoteList items={result.errors} tone="error" />
            </>
          )}

          {result.skipped.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium">
                Skipped ({result.skipped.length}) — everything else was synced
              </p>
              <SkippedTable items={result.skipped} />
            </>
          )}

          {result.warnings.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium text-muted-foreground">
                Notes ({result.warnings.length})
              </p>
              <NoteList items={result.warnings} tone="warning" />
            </>
          )}
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Recent runs
          </h3>
          <ul className="mt-2 divide-y text-xs">
            {runs.map((r) => {
              const notes = r.warnings ?? r.errors ?? [];
              const skips = r.skipped ?? [];
              const openable = notes.length > 0 || skips.length > 0;
              return (
                <li key={r.id} className="py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground tabular-nums">
                      {new Date(r.startedAt).toLocaleString()}
                    </span>
                    <span>{r.seasonCode ?? r.source}</span>
                    <span className="text-muted-foreground">{r.mode}</span>
                    <StatusBadge status={r.status} />
                    {r.counts && (
                      <span className="text-muted-foreground tabular-nums">
                        {r.counts.colorways ?? 0} colorways
                        {r.counts.skipped ? `, ${r.counts.skipped} skipped` : ""}
                      </span>
                    )}
                    {openable && (
                      <button
                        type="button"
                        className="underline text-muted-foreground"
                        onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                      >
                        {openRun === r.id ? "hide" : "details"}
                      </button>
                    )}
                  </div>
                  {openRun === r.id && (
                    <div className="mt-1 rounded-md border bg-muted/30 p-2">
                      {skips.length > 0 && <SkippedTable items={skips} />}
                      {notes.length > 0 && (
                        <NoteList
                          items={notes}
                          tone={r.status === "failed" && !r.warnings ? "error" : "warning"}
                        />
                      )}
                      {r.warnings && r.errors && r.errors.length > 0 && (
                        <NoteList items={r.errors} tone="error" />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
