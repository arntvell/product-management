"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SyncResult {
  status: "ok" | "failed";
  counts: Record<string, number>;
  errors: string[];
  durationMs: number;
}

export function SyncPanel({ defaultSeason = "SS27" }: { defaultSeason?: string }) {
  const router = useRouter();
  const [season, setSeason] = useState(defaultSeason);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSync(mode: "full" | "no-images") {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonCode: season.trim(), mode }),
      });
      const data = await res.json();
      if (!res.ok && !data.counts) {
        setError(data.error ?? `Sync failed (${res.status})`);
      } else {
        setResult(data);
        router.refresh(); // re-fetch server component counts
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
        ids, keeps barcodes, never deletes.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          placeholder="Season code (e.g. SS27)"
          className="w-44"
          disabled={running}
        />
        <Button onClick={() => runSync("full")} disabled={running || !season.trim()}>
          {running ? "Syncing…" : "Sync season"}
        </Button>
        <Button
          variant="outline"
          onClick={() => runSync("no-images")}
          disabled={running || !season.trim()}
        >
          Without images
        </Button>
      </div>

      {running && (
        <p className="mt-3 text-xs text-muted-foreground">
          Walking the season — this can take a minute or two from a local
          machine (the database is remote). You can leave this open.
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      )}

      {result && (
        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            {result.status === "ok" ? "✓ Sync complete" : "⚠ Sync failed"}
            <span className="ml-2 font-normal text-muted-foreground">
              {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {Object.entries(result.counts).map(([k, v]) => (
              <span key={k}>
                {v} {k}
              </span>
            ))}
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs text-destructive">
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
