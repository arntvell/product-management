"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { InboundEventRow, InboundSummary } from "@/lib/loom/warehouse-barcode-report";
import type { ChannelSendSummary } from "@/lib/loom/warehouse-barcode-sync";
import type { ChannelOutcome, VariantBarcodeReport } from "@/lib/master/variant-barcodes";

const GRID = "grid grid-cols-[1.5rem_7rem_5rem_minmax(8rem,1fr)_4rem_minmax(7rem,1fr)_minmax(10rem,1.2fr)] items-center gap-3";

/**
 * Where a row is fixed: the variant editor, searched for the SKU. It writes the
 * master and carries the change to Shopify, Sitoo and Loom with the guards it
 * already has — so the log links there rather than growing a write path of its
 * own.
 */
const fixHref = (sku: string) => `/catalog/variants?q=${encodeURIComponent(sku)}`;

export function WarehouseBarcodeLog({
  summary,
  events,
}: {
  summary: InboundSummary;
  events: InboundEventRow[];
}) {
  const [open, setOpen] = useState<Set<string>>(
    // Anything with a refusal starts expanded. The point of the screen is the
    // rows that did not file; making someone click to find them would bury the
    // only part that needs a person.
    () => new Set(events.filter((e) => e.unfiled.length > 0).map((e) => e.id))
  );

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Inbounds" value={summary.inbounds} hint="deliveries Loom has told us about" />
        <Stat label="Events" value={summary.events} hint="including corrections and retries" />
        <Stat label="Barcodes filed" value={summary.filedAllTime} />
        <Stat
          label="Not filed"
          value={summary.unfiledNow}
          warn={summary.unfiledNow > 0}
          hint="on the newest revision of each inbound"
        />
      </div>

      <ChannelSend summary={summary} />

      {events.length === 0 ? (
        <div className="border p-6 text-body text-muted-foreground">
          Nothing has arrived yet. Loom sends one event per inbound, once every size it
          pushed to Pio without a barcode has one — so an empty list means either no
          delivery has needed this, or Livid has not entered the receiver URL in Loom yet.
        </div>
      ) : (
        <div className="overflow-x-auto border">
          <div className="min-w-[60rem]">
            <div className={`${GRID} border-b bg-muted/40 px-3 py-2 text-fine text-muted-foreground`}>
              <div />
              <div>Received</div>
              <div>Inbound</div>
              <div>PO / supplier</div>
              <div className="text-right">Rev</div>
              <div>Filed</div>
              <div>Not filed</div>
            </div>

            {events.map((e) => {
              const isOpen = open.has(e.id);
              return (
                <div key={e.id} className="border-b last:border-0">
                  <button
                    type="button"
                    onClick={() => toggle(e.id)}
                    className={`${GRID} w-full px-3 py-2 text-left text-body transition-colors hover:bg-muted/40`}
                  >
                    <span className="text-muted-foreground">{isOpen ? "−" : "+"}</span>
                    <span className="tabular-nums text-fine">
                      {e.receivedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}{" "}
                      {e.receivedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span>{e.inboundRef ?? "—"}</span>
                    <span className="truncate">
                      {e.poNumber ?? "—"}
                      {e.supplier ? <span className="text-muted-foreground"> · {e.supplier}</span> : null}
                    </span>
                    <span className="text-right tabular-nums">{e.revision}</span>
                    <span className="tabular-nums">
                      {/* A superseded event was never applied, so it has no
                          tallies. "0 of 0" would read as a delivery that filed
                          nothing, which is a different and worrying thing. */}
                      {e.counts.rows === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {e.counts.filled + e.counts.changed} of {e.counts.rows}
                          {e.counts.changed > 0 ? (
                            <span className="text-muted-foreground"> ({e.counts.changed} changed)</span>
                          ) : null}
                        </>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {e.counts.unfiled > 0 ? (
                        <Chip warn>{e.counts.unfiled} not filed</Chip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {e.status === "superseded" ? <Chip>superseded</Chip> : null}
                      {e.stale ? <Chip>older revision</Chip> : null}
                      {e.isCorrection ? <Chip>correction</Chip> : null}
                      {e.channelsPushedAt ? <Chip>sent to channels</Chip> : null}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="space-y-4 border-t bg-muted/20 px-3 py-3">
                      {e.status === "superseded" ? (
                        <p className="text-fine text-muted-foreground">
                          Not applied. A revision of this inbound at least as new had already been
                          processed, and Loom warns that events can arrive out of order after a
                          retry — so applying this one would have undone a correction.
                        </p>
                      ) : null}

                      {e.unfiled.length > 0 ? (
                        <div>
                          <h3 className="text-fine uppercase tracking-wide text-muted-foreground">
                            Not filed
                          </h3>
                          <p className="mt-1 max-w-3xl text-fine text-muted-foreground">
                            Loom was told the delivery arrived — a refusal here never fails the
                            whole inbound. These sizes still hold whatever barcode Origio had, so
                            each one is a decision for a person.
                          </p>
                          <div className="mt-2 divide-y border bg-background">
                            {e.unfiled.map((u, i) => (
                              <div
                                key={`${u.sku}-${i}`}
                                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-body"
                              >
                                <span className="font-medium">{u.sku}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {u.barcode || "(empty)"}
                                </span>
                                <span className="grow text-fine text-muted-foreground">{u.reason}</span>
                                <Link href={fixHref(u.sku)} className="shrink-0 border px-2 py-0.5 text-fine hover:bg-muted">
                                  Open in variant editor
                                </Link>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {e.affected.length > 0 ? (
                        <div>
                          <h3 className="text-fine uppercase tracking-wide text-muted-foreground">
                            {e.channelsPushedAt ? "Filed and sent" : "Filed — still to push"}
                          </h3>
                          <p className="mt-1 max-w-3xl text-fine text-muted-foreground">
                            {e.channelsPushedAt ? (
                              <>
                                Sent to the channels on{" "}
                                {e.channelsPushedAt.toLocaleDateString("en-GB", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                                {e.channelReport ? (
                                  <>
                                    {" — "}
                                    Shopify {e.channelReport.shopify.written}, Sitoo{" "}
                                    {e.channelReport.sitoo.written} written
                                  </>
                                ) : null}
                                .
                              </>
                            ) : (
                              <>
                                The master holds these barcodes. Shopify and Sitoo are written
                                straight after the delivery is filed, so rows left here are ones a
                                run could not finish — use Send above to try them again.
                              </>
                            )}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {e.affected.map((c) => (
                              <Link
                                key={c.id}
                                href={fixHref(c.colorwaySku)}
                                className="border bg-background px-2 py-1 text-fine hover:bg-muted"
                              >
                                {c.colorwaySku}
                                <span className="text-muted-foreground"> · {c.name}</span>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <p className="text-fine text-muted-foreground">
                        <span className="text-muted-foreground/70">event</span> {e.eventId}
                        {"  ·  "}
                        <span className="text-muted-foreground/70">batch</span> {e.batchId}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Sending the filed barcodes on to the channels.
 *
 * Everything pending at once, not one inbound at a time. Shopify and Sitoo are
 * per size and would be fine either way, but Loom is pushed per COLOURWAY — two
 * inbounds carrying sizes of the same garment would otherwise ask for two
 * confirmations of what is one push. One scope, one confirmation.
 *
 * Preview first, always, and nothing reaches Loom until the preview has been
 * read and confirmed: the preview is the scope, and a Loom transmission is not
 * something to discover after the fact.
 */
function ChannelSend({ summary }: { summary: InboundSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncResponse | null>(null);
  const [result, setResult] = useState<ChannelSendSummary | null>(null);

  if (summary.pendingChannels === 0 && !result) {
    return (
      <div className="border p-3 text-fine text-muted-foreground">
        Every filed barcode has been sent to the channels the garment is live in. A new
        delivery, or a correction to one, puts rows back here.
      </div>
    );
  }

  async function post(body: unknown): Promise<SyncResponse | null> {
    const res = await fetch("/api/loom/warehouse-barcodes/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // A platform timeout or an auth redirect answers in HTML; an unguarded
    // res.json() would throw past the toast and the button would just go quiet.
    const text = await res.text();
    let data: SyncResponse & { error?: string };
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}` } as SyncResponse & {
        error: string;
      };
    }
    if (!res.ok || data.error) {
      toast.error(data.error ?? `Request failed (HTTP ${res.status})`);
      return null;
    }
    return data;
  }

  async function runPreview() {
    setResult(null);
    setBusy("Reading Shopify, Sitoo and Loom…");
    try {
      const r = await post({ dryRun: true });
      if (r) setPreview(r);
    } catch (e) {
      toast.error(`Preview failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("Writing Shopify and Sitoo…");
    try {
      // One call. The route writes the channels and records the outcome itself —
      // with Loom out of scope there is no job that can outlast the request.
      const r = await post({ dryRun: false });
      if (!r) return;
      setResult(r.summary);
      setPreview(null);
      if (r.stillPending) {
        toast.warning("Some writes failed — the rows stay pending and can be sent again.");
      } else {
        toast.success("Sent to every channel the garments are live in.");
      }
      router.refresh();
    } catch (e) {
      toast.error(`Send failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const rows = preview?.report.rows ?? [];

  return (
    <div className="border">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="text-body">
          <b className="tabular-nums">{summary.pendingChannels}</b> size
          {summary.pendingChannels === 1 ? "" : "s"} across{" "}
          <b className="tabular-nums">{summary.pendingColorways}</b> colourway
          {summary.pendingColorways === 1 ? "" : "s"} to send
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={runPreview}
            disabled={!!busy}
            className="border px-3 py-1.5 text-body transition-colors hover:bg-muted disabled:opacity-50"
          >
            {busy === "Reading Shopify, Sitoo and Loom…" ? "Reading…" : "Preview"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!!busy || !preview || rows.length === 0}
            className="border bg-foreground px-3 py-1.5 text-body text-background transition-opacity disabled:opacity-40"
            title={preview ? undefined : "Preview first — the preview is the scope"}
          >
            {busy && busy !== "Reading Shopify, Sitoo and Loom…" ? busy : "Send to channels"}
          </button>
        </div>
      </div>

      {result ? (
        <div className="px-3 py-3 text-body">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>Shopify <b className="tabular-nums">{result.shopify.written}</b> written</span>
            <span>Sitoo <b className="tabular-nums">{result.sitoo.written}</b> written</span>
            {result.shopify.failed + result.sitoo.failed > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                <b className="tabular-nums">{result.shopify.failed + result.sitoo.failed}</b> failed —
                still pending
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="px-3 py-3">
          <p className="mb-2 max-w-3xl text-fine text-muted-foreground">
            Nothing has been sent yet. A size that is not linked to a channel has nothing to
            correct there and carries the barcode when it is first published; one that already
            agrees is left alone. Loom is not a target — the barcode came from there.
          </p>
          <div className="overflow-x-auto border bg-background">
            <div className="min-w-[44rem] divide-y">
              <div className="grid grid-cols-[minmax(12rem,1.6fr)_8rem_repeat(2,minmax(6rem,1fr))] gap-3 bg-muted/40 px-3 py-1.5 text-fine text-muted-foreground">
                <div>Size</div>
                <div>Barcode</div>
                <div>Shopify</div>
                <div>Sitoo</div>
              </div>
              {rows.map((r) => (
                <div
                  key={r.variantSku}
                  className="grid grid-cols-[minmax(12rem,1.6fr)_8rem_repeat(2,minmax(6rem,1fr))] items-center gap-3 px-3 py-1.5 text-body"
                >
                  <span className="truncate">{r.variantSku}</span>
                  <span className="tabular-nums text-muted-foreground">{r.to ?? "—"}</span>
                  <Outcome o={r.shopify} />
                  <Outcome o={r.sitoo} />
                </div>
              ))}
            </div>
          </div>
          {Object.entries(preview.report.channelErrors).filter(([, v]) => v).length > 0 ? (
            <div className="mt-2 space-y-1">
              {Object.entries(preview.report.channelErrors).map(([k, v]) =>
                v ? (
                  <p key={k} className="text-fine text-amber-700 dark:text-amber-400">
                    {k} could not be read: {v}
                  </p>
                ) : null
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface SyncResponse {
  ok?: boolean;
  dryRun?: boolean;
  eventIds: string[];
  colorwayIds: string[];
  pending: number;
  report: VariantBarcodeReport;
  summary: ChannelSendSummary;
  /** finish branch only. */
  marked?: number;
  stillPending?: boolean;
  error?: string;
}

const OUTCOME_LABEL: Record<ChannelOutcome["state"], string> = {
  write: "will write",
  written: "written",
  failed: "failed",
  agrees: "agrees",
  "not-live": "not linked",
  refused: "refused",
  "n/a": "—",
};

function Outcome({ o }: { o: ChannelOutcome }) {
  const muted = o.state === "not-live" || o.state === "agrees" || o.state === "n/a";
  return (
    <span
      className={`text-fine ${
        o.state === "failed" || o.state === "refused"
          ? "text-amber-700 dark:text-amber-400"
          : muted
            ? "text-muted-foreground"
            : ""
      }`}
      title={o.note}
    >
      {OUTCOME_LABEL[o.state]}
    </span>
  );
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-fine ${
        warn ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="border p-3">
      <div className="text-fine text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-xl tabular-nums ${warn ? "text-amber-700 dark:text-amber-400" : ""}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-fine text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
