"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PUBLISH_CHANNELS as CHANNELS,
  PUBLISH_CHANNEL_LABELS as CHANNEL_LABELS,
  type PublishChannelKey as ChannelKey,
} from "@/lib/master/fields";

interface Publication {
  channel: string;
  published: boolean;
  externalId: string | null;
  lastPushedAt: string | null;
  lastPushStatus: string | null;
}

/** What a preview or a push reported, per channel. */
interface ChannelReport {
  dryRun?: boolean;
  ok?: boolean;
  summary?: string;
  send?: string[];
  notSent?: string[];
  warnings?: string[];
  error?: string;
  adminUrl?: string;
}

/**
 * Where this product goes, and pushing it there — one row per channel.
 *
 * Each row targets the channel, says whether the product is there yet, previews
 * exactly what a push would send, and pushes to that channel alone. The pushes
 * go through /push-to, the same paths the grids and the wizard use: Shopify
 * creates (and lists on the sales channels) or sends only what changed; Sitoo
 * updates the till's title and price, or creates the product; Loom gets the
 * stock registry or, for Livid, the catalogue.
 */
export function ChannelsPanel({
  colorwayId,
  initialPublications,
  seasonCodes = [],
  brandIsLivid,
  sitooSizes,
  shopifyAdminUrl,
}: {
  colorwayId: string;
  initialPublications: Publication[];
  seasonCodes?: string[];
  brandIsLivid: boolean;
  /** How many of the product's sizes the till already holds. */
  sitooSizes: { linked: number; total: number };
  /** The product in Shopify's admin, once it is there. */
  shopifyAdminUrl: string | null;
}) {
  const [pubs, setPubs] = useState<Publication[]>(initialPublications);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<ChannelKey | "ALL" | null>(null);
  const [reports, setReports] = useState<Partial<Record<ChannelKey, ChannelReport>>>({});
  const [sitooLinked, setSitooLinked] = useState(sitooSizes.linked);
  const [adminUrl, setAdminUrl] = useState(shopifyAdminUrl);

  const targeted = (c: ChannelKey) => pubs.some((p) => p.channel === c);
  const pubFor = (c: ChannelKey) => pubs.find((p) => p.channel === c);

  async function toggle(channel: ChannelKey) {
    // Every channel, from its current state — the route treats an absent key as
    // "keep", but sending the whole picture keeps this honest about the change.
    const next = Object.fromEntries(CHANNELS.map((c) => [c, targeted(c)])) as Record<ChannelKey, boolean>;
    next[channel] = !next[channel];
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/colorways/${colorwayId}/channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPubs(data.publications);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update channels");
    } finally {
      setSaving(false);
    }
  }

  async function call(channel: ChannelKey, dryRun: boolean): Promise<ChannelReport> {
    const res = await fetch(`/api/catalog/colorways/${colorwayId}/push-to`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, dryRun }),
    });
    const data = (await res.json().catch(() => ({}))) as ChannelReport;
    if (!res.ok && !data.summary) throw new Error(data.error ?? `${CHANNEL_LABELS[channel]} failed`);
    return data;
  }

  async function preview(channel: ChannelKey) {
    setBusy(channel);
    try {
      const r = await call(channel, true);
      setReports((p) => ({ ...p, [channel]: r }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  }

  /** Push one channel. Returns whether it went through, for Push to all. */
  async function push(channel: ChannelKey, ask = true): Promise<boolean> {
    // From Push to all (ask=false) the whole run holds busy="ALL".
    if (ask) {
      // The confirm states what will be sent — the preview, run first.
      let plan: ChannelReport;
      try {
        plan = await call(channel, true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Preview failed");
        return false;
      }
      setReports((p) => ({ ...p, [channel]: plan }));
      const lines = [plan.summary, ...(plan.send ?? []).map((s) => `• ${s}`)].filter(Boolean).join("\n");
      if (!confirm(`Push to ${CHANNEL_LABELS[channel]}?\n\n${lines}`)) return false;
    }
    if (ask) setBusy(channel);
    try {
      const r = await call(channel, false);
      setReports((p) => ({ ...p, [channel]: r }));
      const now = new Date().toISOString();
      if (r.ok !== false) {
        setPubs((prev) =>
          prev.map((p) => (p.channel === channel ? { ...p, published: true, lastPushedAt: now, lastPushStatus: "ok" } : p))
        );
        if (channel === "SITOO") setSitooLinked(sitooSizes.total);
        if (channel === "SHOPIFY" && r.adminUrl) setAdminUrl(r.adminUrl);
      }
      const w = r.warnings ?? [];
      if (r.ok === false) toast.error(`${CHANNEL_LABELS[channel]}: ${r.summary ?? "not sent"}${w.length ? ` — ${w[0]}` : ""}`);
      else if (w.length) toast.warning(`${CHANNEL_LABELS[channel]}: ${r.summary} ${w.join(" · ")}`);
      else toast.success(`${CHANNEL_LABELS[channel]}: ${r.summary}`);
      return r.ok !== false;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
      return false;
    } finally {
      if (ask) setBusy(null);
    }
  }

  async function pushAll() {
    const list = CHANNELS.filter((c) => targeted(c));
    if (!list.length) return toast.error("Choose at least one channel first.");
    if (!confirm(`Push to ${list.map((c) => CHANNEL_LABELS[c]).join(", ")}? Each sends only what it needs; Loom goes last.`))
      return;
    setBusy("ALL");
    // Shopify before Loom: Loom's registry joins on the Shopify ids a create mints.
    for (const c of list) {
      const ok = await push(c, false);
      if (!ok && c === "SHOPIFY" && list.includes("LOOM")) {
        toast.error("Stopped before Loom — Shopify did not go through.");
        break;
      }
    }
    setBusy(null);
  }

  function liveText(c: ChannelKey): string {
    const p = pubFor(c);
    if (c === "SHOPIFY") return p?.externalId || adminUrl ? "On Shopify" : "Not on Shopify yet";
    if (c === "SITOO")
      return sitooLinked >= sitooSizes.total && sitooSizes.total > 0
        ? "In the till"
        : sitooLinked > 0
          ? `${sitooLinked} of ${sitooSizes.total} sizes in the till`
          : "Not in the till yet";
    return p?.lastPushedAt ? (brandIsLivid ? "In Loom's catalogue" : "In Loom's stock registry") : "Not sent to Loom yet";
  }

  return (
    <section className="mx-auto max-w-3xl px-6 pb-12">
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-6">
        <div>
          <h2 className="text-section">Channels</h2>
          <p className="mt-1 text-fine text-muted-foreground">
            Saving changes Origo only. Push a channel to send it there — the preview shows exactly what
            goes.{seasonCodes.length ? ` Price from ${seasonCodes[0]}.` : ""}
          </p>
        </div>
        <Button size="sm" onClick={pushAll} disabled={busy !== null || saving}>
          {busy === "ALL" ? "Pushing…" : "Push to all"}
        </Button>
      </div>

      <div className="mt-4 divide-y border">
        {CHANNELS.map((c) => {
          const p = pubFor(c);
          const on = targeted(c);
          const report = reports[c];
          return (
            <div key={c} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[9rem] items-center gap-2 text-body">
                  <input type="checkbox" checked={on} disabled={saving} onChange={() => toggle(c)} />
                  {CHANNEL_LABELS[c]}
                </label>
                <span className="text-fine text-muted-foreground">
                  {liveText(c)}
                  {p?.lastPushedAt ? ` · last pushed ${new Date(p.lastPushedAt).toLocaleString("nb-NO")}` : ""}
                  {c === "SHOPIFY" && adminUrl ? (
                    <>
                      {" · "}
                      <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={adminUrl}>
                        open in Shopify
                      </a>
                    </>
                  ) : null}
                </span>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" disabled={!on || busy !== null} onClick={() => preview(c)}>
                    Preview
                  </Button>
                  <Button size="sm" disabled={!on || busy !== null} onClick={() => push(c)}>
                    {busy === c ? "Pushing…" : `Push to ${CHANNEL_LABELS[c]}`}
                  </Button>
                </span>
              </div>
              {!on ? (
                <p className="mt-2 text-fine text-muted-foreground">
                  Not targeted — tick it to make this product a {CHANNEL_LABELS[c]} product.
                </p>
              ) : null}
              {report ? (
                <div className="mt-3 space-y-1 bg-muted/40 p-3 text-fine">
                  <div className="text-body">
                    {report.dryRun ? "Would: " : ""}
                    {report.summary ?? report.error}
                  </div>
                  {report.send?.length ? (
                    <ul className="list-disc pl-5">
                      {report.send.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  ) : null}
                  {report.notSent?.map((s) => (
                    <div key={s} className="text-muted-foreground">
                      Not sent — {s}
                    </div>
                  ))}
                  {report.warnings?.map((w) => (
                    <div key={w} className="text-ink">
                      {w}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
