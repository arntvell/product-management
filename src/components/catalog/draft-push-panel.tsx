"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PUBLISH_CHANNEL_LABELS } from "@/lib/master/fields";

type Channel = "SHOPIFY" | "LOOM" | "SITOO";

interface Blocked {
  channel: string;
  reason: string;
  waivable: boolean;
}

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
  unfinishedBatchId,
  kind = "create",
  note,
  allowIncomplete = false,
  autoStart = false,
  onBatchCreated,
  title = "Publish",
}: {
  /** Null when the batch is not one draft's — an import publishes the colorways
   *  of many drafts as one batch, and `PushBatch.draftId` is single-valued. */
  draftId: string | null;
  colorwayIds: string[];
  channels: Channel[];
  /** A batch for this draft that is still running — typically Loom items left
   *  AWAITING_JOB when the client stopped polling. Without this the batch is
   *  only reachable through the API, and a refresh strands it. */
  unfinishedBatchId?: string | null;
  kind?: string;
  note?: string;
  /** Waive the soft merchandising gaps when the batch is created, instead of
   *  making the operator press "Push anyway" on a gap the screen they came from
   *  cannot fill. Never waives no-variants / no-price. */
  allowIncomplete?: boolean;
  /** Start the live push as soon as the panel mounts. This is what makes
   *  creating a product publish it, rather than leaving it in the master for
   *  someone to remember. Fires once. */
  autoStart?: boolean;
  /** Told the batch id as soon as there is one, so the caller can put it
   *  somewhere a refresh survives. */
  onBatchCreated?: (batchId: string) => void;
  title?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [batchId, setBatchId] = useState<string | null>(unfinishedBatchId ?? null);
  // What the batch in `batchId` was last driven as. A dry run leaves BLOCKED
  // items on the batch exactly as a live run does, so without this the waiver
  // button below would turn a deliberate dry run into a live push.
  const [lastDryRun, setLastDryRun] = useState(false);

  // The only gaps an operator may waive. A candle has no care page and no fit
  // guide and never will, so without this the push is dead on arrival for most
  // external product — but "no variants" and "no price" are not on this list and
  // no button reaches them.
  const waivable = blocked.filter((b) => b.waivable);

  // Publish without being asked to. React runs effects twice in development and
  // a re-render must not mint a second batch, so the guard is a ref rather than
  // state — a duplicate here is a duplicate product in Shopify.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !channels.length || !colorwayIds.length) return;
    started.current = true;
    void push(false);
    // Mount-only on purpose: `push` closes over props that do not change for the
    // life of this panel, and re-running it would be a second push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Drive a batch to completion in bounded calls. The server never blocks on a
   *  channel, so the client keeps asking until it says done — that is how a 600s
   *  Loom job fits inside a 300s function. */
  async function drive(id: string, dryRun: boolean, endpoint: "run" | "retry", extra: object = {}) {
    let p: Progress | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`/api/catalog/push/batch/${id}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun, ...(i === 0 ? extra : {}) }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      p = res.progress;
      setProgress(p);
      if (p?.done) break;
      await new Promise((r) => setTimeout(r, p?.nextPollAfterMs ?? 2000));
      endpoint = "run"; // the waiver is recorded on the batch; only send it once
    }
    return p;
  }

  async function pushAnyway() {
    if (!batchId) return;
    // A waiver given during a dry run is still a dry run. The waiver is recorded
    // on the batch, so the later live push honours it — clicking this after a
    // dry run must not be the one path that goes live without saying so.
    const dryRun = lastDryRun;
    setBusy(true);
    try {
      // Every blocked channel, not just Shopify: Loom blocks itself on Shopify
      // ("waiting on the Shopify push for its inventory ids"), so retrying
      // Shopify alone would leave Loom stuck behind a block that just cleared.
      const p = await drive(batchId, dryRun, "retry", { waiveIncomplete: true });
      setBlocked([]);
      toast[p?.status === "ok" ? "success" : "error"](
        dryRun ? "Dry run finished — waiver recorded" : `Push ${p?.status ?? "finished"}`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setBusy(false);
    }
  }

  /** Pick a batch left in flight back up — one more round of polling. */
  async function resume() {
    if (!batchId) return;
    setBusy(true);
    try {
      const p = await drive(batchId, false, "run");
      toast[p?.done ? "success" : "info"](
        p?.done ? `Push ${p.status}` : "Still running — Loom has not finished its job yet"
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resume failed");
    } finally {
      setBusy(false);
    }
  }

  async function push(dryRun: boolean) {
    setBusy(true);
    try {
      const created = await fetch("/api/catalog/push/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          colorwayIds,
          channels,
          draftId,
          kind,
          note,
          allowIncomplete,
        }),
      }).then((r) => r.json());
      if (created.error) throw new Error(created.error);
      setBlocked(created.blocked ?? []);
      setBatchId(created.batchId);
      setLastDryRun(dryRun);
      onBatchCreated?.(created.batchId);

      const p = await drive(created.batchId, dryRun, "run");
      // A batch that has not finished is not a failure — Loom jobs outlive the
      // polling window, and the resume button below picks it up.
      toast[p?.done && p.status === "ok" ? "success" : p?.done ? "error" : "info"](
        !p?.done
          ? "Still running — Loom has not finished its job yet"
          : dryRun
            ? "Dry run finished"
            : `Push ${p.status}`
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
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {channels.map((c) => PUBLISH_CHANNEL_LABELS[c]).join(", ") || "no channels"} ·
            Shopify first, so Loom receives its inventory ids
          </div>
        </div>
        <div className="flex gap-2">
          {unfinishedBatchId && !progress ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void resume()}>
              Resume last push
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !colorwayIds.length}
            onClick={() => push(true)}
          >
            Dry run
          </Button>
          <Button
            size="sm"
            disabled={busy || !channels.length || !colorwayIds.length}
            onClick={() => push(false)}
          >
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
          {waivable.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !batchId}
                onClick={() => void pushAnyway()}
              >
                {lastDryRun ? "Dry run anyway" : "Push anyway"} (
                {waivableReasons(waivable)})
              </Button>
              <span className="text-[11px] opacity-80">
                {lastDryRun
                  ? "Still a dry run — the waiver is recorded on the batch, so the live push honours it."
                  : "Recorded on the batch."}{" "}
                A product with no variants or no price stays blocked — that is not
                waivable, and a retry reports it as failed rather than held.
              </span>
            </div>
          ) : null}
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

/** The distinct gaps being waived, so the button names what it is giving up. */
function waivableReasons(blocked: Blocked[]): string {
  const gaps = new Set<string>();
  for (const b of blocked)
    for (const g of b.reason.replace(/^missing /, "").split(", ")) gaps.add(g);
  return `waives ${[...gaps].join(", ")}`;
}
