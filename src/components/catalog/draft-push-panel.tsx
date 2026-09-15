"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PUBLISH_CHANNEL_LABELS } from "@/lib/master/fields";

type Channel = "SHOPIFY" | "LOOM" | "SITOO";

interface Progress {
  batchId: string;
  done: boolean;
  status: string;
  counts: Record<string, Record<string, number>>;
  nextPollAfterMs?: number;
}

export function DraftPushPanel({
  draftId,
  colorwayIds,
  channels,
}: {
  draftId: string;
  colorwayIds: string[];
  channels: Channel[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [blocked, setBlocked] = useState<Array<{ channel: string; reason: string }>>([]);

  async function push(dryRun: boolean) {
    setBusy(true);
    try {
      const created = await fetch("/api/catalog/push/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ colorwayIds, channels, draftId, kind: "create" }),
      }).then((r) => r.json());
      if (created.error) throw new Error(created.error);
      setBlocked(created.blocked ?? []);

      // Drive it to completion in bounded calls. The server never blocks on a
      // channel, so the client keeps asking until it says done — that is how a
      // 600s Loom job fits inside a 300s function.
      let p: Progress | null = null;
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`/api/catalog/push/batch/${created.batchId}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dryRun }),
        }).then((r) => r.json());
        if (res.error) throw new Error(res.error);
        p = res.progress;
        setProgress(p);
        if (p?.done) break;
        await new Promise((r) => setTimeout(r, p?.nextPollAfterMs ?? 2000));
      }
      toast[p?.status === "ok" ? "success" : "error"](
        dryRun ? "Dry run finished" : `Push ${p?.status ?? "finished"}`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Publish</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {channels.map((c) => PUBLISH_CHANNEL_LABELS[c]).join(", ") || "no channels"} ·
            Shopify first, so Loom receives its inventory ids
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => push(true)}>
            Dry run
          </Button>
          <Button size="sm" disabled={busy || !channels.length} onClick={() => push(false)}>
            {busy ? "Pushing…" : "Push to channels"}
          </Button>
        </div>
      </div>

      {blocked.length ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {blocked.length} item{blocked.length === 1 ? "" : "s"} held back:
          <ul className="mt-1 list-inside list-disc">
            {blocked.slice(0, 6).map((b, i) => (
              <li key={i}>
                {b.channel}: {b.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {progress ? (
        <div className="mt-3 space-y-1.5 text-xs">
          {Object.entries(progress.counts).map(([channel, states]) => (
            <div key={channel} className="flex gap-2">
              <span className="w-20 font-medium">{channel}</span>
              <span className="text-muted-foreground">
                {Object.entries(states)
                  .map(([s, n]) => `${n} ${s.toLowerCase()}`)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
