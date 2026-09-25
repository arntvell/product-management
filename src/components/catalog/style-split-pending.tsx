"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, CheckCircle2Icon, XCircleIcon } from "lucide-react";
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

type TaskState = "running" | "ok" | "error";

interface Task {
  styleId: string;
  styleSku: string;
  styleName: string;
  seasons: string[];
  state: TaskState;
  startedAt: number;
  finishedAt?: number;
  headline?: string;
  /** Counters and warnings worth reading even when the push succeeded. */
  detail: string[];
}

interface LoomJobSummary {
  status?: string;
  created?: number;
  updated?: number;
  archived?: number;
  variantsCreated?: number;
  variantsUpdated?: number;
  variantsMoved?: number;
  variantsMoveRefused?: number;
  pioReparentPending?: string[];
  itemErrors?: unknown[];
  fatalError?: string;
  unconfirmed?: boolean;
}

interface RunResult {
  ok?: boolean;
  sent?: number;
  jobId?: string;
  job?: LoomJobSummary;
  skipped?: { colorwayId: string; reason: string }[];
}

interface VerifyBody {
  ok?: boolean;
  error?: string;
  seasons?: string[];
  warnings?: string[];
  runs?: { season: string; colorways: number; result?: RunResult; error?: string }[];
}

/** Whole seconds since a timestamp, for the running counter. */
const secs = (from: number, to: number) => Math.max(0, Math.round((to - from) / 1000));

/**
 * Turn a settled push into the handful of lines worth reading.
 *
 * `updated` counts COLORWAY rows only — Loom confirmed this on 2026-09-17 — so a
 * delivery that wrote nothing but identity legitimately reports `updated: 0`.
 * Reading that as "nothing landed" is the mistake this list exists to prevent,
 * which is why the variant counters are shown beside it rather than hidden.
 */
function describe(body: VerifyBody): { ok: boolean; headline: string; detail: string[] } {
  const runs = body.runs ?? [];
  const detail: string[] = [];
  let sent = 0;
  let refused = 0;
  let failed = false;

  for (const r of runs) {
    if (r.error) {
      failed = true;
      detail.push(`${r.season}: ${r.error}`);
      continue;
    }
    const res = r.result;
    const job = res?.job;
    if (!res?.ok) failed = true;
    sent += res?.sent ?? 0;

    const bits: string[] = [];
    if (job?.created != null) bits.push(`${job.created} created`);
    if (job?.updated != null) bits.push(`${job.updated} updated`);
    if (job?.archived) bits.push(`${job.archived} archived`);
    if (job?.variantsCreated) bits.push(`${job.variantsCreated} sizes created`);
    if (job?.variantsUpdated) bits.push(`${job.variantsUpdated} sizes updated`);
    if (job?.variantsMoved) bits.push(`${job.variantsMoved} sizes moved`);
    detail.push(`${r.season}: ${bits.join(", ") || "no counters returned"}`);

    // Every one of these means the push did not do what it looks like it did.
    if (job?.variantsMoveRefused) {
      refused += job.variantsMoveRefused;
      detail.push(
        `${r.season}: ${job.variantsMoveRefused} size move(s) REFUSED — Loom skips the whole ` +
          `colourway in preflight, so those products are not there.`
      );
    }
    if (job?.unconfirmed)
      detail.push(`${r.season}: job never settled inside our window — state unknown, not failed.`);
    if (job?.fatalError) detail.push(`${r.season}: ${job.fatalError}`);
    if (job?.itemErrors?.length)
      detail.push(`${r.season}: ${job.itemErrors.length} item error(s) — check the job.`);
    if (job?.pioReparentPending?.length)
      detail.push(
        `${r.season}: ${job.pioReparentPending.length} SKU(s) not pushed to Pio — the warehouse ` +
          `keeps the old grouping and name until someone reconciles it there.`
      );
    // A skipped colourway never reaches Loom, so it stays under its old style
    // and the re-nest is only half applied.
    if (res?.skipped?.length)
      detail.push(`${r.season}: ${res.skipped.length} colourway(s) skipped and NOT sent.`);
  }

  for (const w of body.warnings ?? []) detail.push(w);
  if (body.error) {
    failed = true;
    detail.unshift(body.error);
  }

  const headline = failed
    ? refused
      ? `Refused — ${refused} size move(s) rejected by Loom.`
      : "Loom did not accept the whole push."
    : `Sent ${sent} colourway${sent === 1 ? "" : "s"} across ${(body.seasons ?? []).join(", ")}.`;

  return { ok: !failed, headline, detail };
}

/**
 * Styles re-nested here that Loom has not been told about.
 *
 * Worth its own panel rather than a column on a row, because once an apply
 * lands the proposal disappears from the report — the work is invisible from
 * that moment until someone remembers it. This is the only place a half-finished
 * repair shows up.
 *
 * A push runs as a tracked task rather than a blocking button. The request still
 * waits for Loom's job to settle server-side — that is what makes "pushed" mean
 * "written", and shortening it to mere acceptance is exactly how 217 products
 * were once recorded as pushed while nothing was stored — so a single style can
 * take minutes. Blocking every other button for that long, with nothing moving
 * on screen, is indistinguishable from a hang.
 */
export function StyleSplitPending() {
  const [pending, setPending] = useState<PendingStyle[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const running = tasks.some((t) => t.state === "running");
  // Rows with a task in flight are held out of the list below, so the same push
  // cannot be started twice from two clicks.
  const claimed = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog/style-splits/pending");
      if (!res.ok) {
        // A 404 here means the deployment predates this endpoint, which is
        // worth saying out loud — it is indistinguishable from "nothing
        // pending" otherwise, and the two call for opposite reactions.
        throw new Error(
          res.status === 404
            ? "This build does not have /api/catalog/style-splits/pending yet — the deployment is older than the code."
            : `HTTP ${res.status} from /api/catalog/style-splits/pending`
        );
      }
      const body = await res.json();
      setPending(body.pending ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A ticking elapsed counter, only while something is in flight.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // The fetch is client-side, so leaving the page abandons the RESULT — the
  // server keeps going and the outcome is recoverable by reloading this panel,
  // but nobody would know to look.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const push = useCallback(
    async (s: PendingStyle) => {
      if (claimed.current.has(s.styleId)) return;
      if (
        !window.confirm(
          `Send ${s.styleSku} to PRODUCTION Loom?\n\n` +
            `${s.colorways} colourways, one delivery per season ` +
            `(${s.seasons.join(", ")}). This is what tells Loom about the ` +
            `re-nesting already applied here.`
        )
      )
        return;

      claimed.current.add(s.styleId);
      setTasks((t) => [
        {
          styleId: s.styleId,
          styleSku: s.styleSku,
          styleName: s.styleName,
          seasons: s.seasons,
          state: "running",
          startedAt: Date.now(),
          detail: [],
        },
        ...t.filter((x) => x.styleId !== s.styleId),
      ]);
      setNow(Date.now());

      const settle = (patch: Partial<Task>) =>
        setTasks((t) =>
          t.map((x) =>
            x.styleId === s.styleId ? { ...x, ...patch, finishedAt: Date.now() } : x
          )
        );

      try {
        const res = await fetch("/api/catalog/style-splits/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleIds: [s.styleId], dryRun: false }),
        });
        const body: VerifyBody = await res.json().catch(() => ({}));
        const { ok, headline, detail } = describe(body);
        const httpOk = res.ok && body.ok !== false;
        settle({
          state: httpOk && ok ? "ok" : "error",
          headline: httpOk
            ? headline
            : body.error ?? `HTTP ${res.status} — Loom did not accept the push.`,
          detail,
        });
      } catch (e) {
        // A network failure here is genuinely unknown, not a failure: the
        // delivery may well have been accepted and be running on Loom's side.
        settle({
          state: "error",
          headline: `Lost contact: ${(e as Error).message}`,
          detail: [
            "The delivery may still have reached Loom. Reload this panel before retrying — " +
              "a style that has gone will no longer be listed.",
          ],
        });
      } finally {
        claimed.current.delete(s.styleId);
        await load();
      }
    },
    [load]
  );

  const dismiss = (styleId: string) =>
    setTasks((t) => t.filter((x) => x.styleId !== styleId || x.state === "running"));

  if (error) {
    return (
      <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-xs">
        <strong className="text-foreground">
          Could not check what is waiting to go to Loom.
        </strong>{" "}
        {error}
        <p className="mt-1 text-muted-foreground">
          Styles already re-nested here would not be listed, so treat this as
          unknown rather than empty.
        </p>
      </div>
    );
  }

  if (!loaded) return null;

  const waiting = (pending ?? []).filter(
    (s) => !tasks.some((t) => t.styleId === s.styleId && t.state === "running")
  );
  if (!waiting.length && !tasks.length) return null;

  return (
    <div className="mt-5 space-y-3">
      {tasks.length ? (
        <div className="rounded-lg border bg-background p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Pushing to Loom
              {running ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {tasks.filter((t) => t.state === "running").length} in progress — leaving this
                  page abandons the result, not the push
                </span>
              ) : null}
            </h2>
            {tasks.some((t) => t.state !== "running") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTasks((t) => t.filter((x) => x.state === "running"))}
              >
                Clear finished
              </Button>
            ) : null}
          </div>

          <div className="mt-3 space-y-2">
            {tasks.map((t) => (
              <div
                key={t.styleId}
                className={
                  "rounded-md border px-3 py-2 text-sm " +
                  (t.state === "running"
                    ? "border-border bg-muted/40"
                    : t.state === "ok"
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-destructive/40 bg-destructive/5")
                }
              >
                <div className="flex items-start gap-2">
                  {t.state === "running" ? (
                    <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : t.state === "ok" ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{t.styleName}</span>{" "}
                    <code className="text-xs">{t.styleSku}</code>
                    <div className="text-xs text-muted-foreground">
                      {t.state === "running" ? (
                        <>
                          waiting for Loom&rsquo;s job to settle · {secs(t.startedAt, now)}s ·{" "}
                          {t.seasons.join(", ")}
                        </>
                      ) : (
                        <>
                          {t.headline} · took {secs(t.startedAt, t.finishedAt ?? Date.now())}s
                        </>
                      )}
                    </div>
                    {t.detail.length ? (
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {t.detail.map((d, i) => (
                          <li key={i}>· {d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {t.state !== "running" ? (
                    <Button size="sm" variant="ghost" onClick={() => dismiss(t.styleId)}>
                      Dismiss
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {waiting.length ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold">
            Applied here, not yet in Loom — {waiting.length}
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            The colourways have moved in Origio, so the proposal is gone from the list
            below. Loom still holds the old grouping until these are pushed.
          </p>
          <div className="mt-3 space-y-2">
            {waiting.map((s) => (
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
                {/* Not disabled while another push runs: they are independent
                    deliveries, and one slow style should not block the rest. */}
                <Button size="sm" onClick={() => push(s)}>
                  Push to Loom
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
