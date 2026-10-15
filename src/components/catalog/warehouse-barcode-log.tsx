"use client";

import { useState } from "react";
import Link from "next/link";
import type { InboundEventRow, InboundSummary } from "@/lib/loom/warehouse-barcode-report";

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
                            Filed — still to push
                          </h3>
                          <p className="mt-1 max-w-3xl text-fine text-muted-foreground">
                            The master holds these barcodes now. Shopify, Sitoo and Loom do not
                            until someone sends them: the receiver does not push, because a Loom
                            push needs a person and the channel writes do not fit inside the
                            fifteen seconds Loom allows a reply.
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
