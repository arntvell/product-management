"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rejectionReason } from "@/lib/master/barcode";
import type {
  AddSizeContext,
  AddSizeReport,
  AddSizeSearchRow,
  StepOutcome,
  StepState,
} from "@/lib/master/add-size";

const TONE: Record<StepState, string> = {
  write: "text-blue-700 dark:text-blue-400",
  written: "text-emerald-700 dark:text-emerald-400",
  exists: "text-muted-foreground",
  "not-live": "text-muted-foreground",
  refused: "text-amber-700 dark:text-amber-400",
  skipped: "text-amber-700 dark:text-amber-400",
  failed: "text-destructive",
  "n/a": "text-muted-foreground",
};

const LABEL: Record<StepState, string> = {
  write: "will add",
  written: "added",
  exists: "already there",
  "not-live": "not in this channel",
  refused: "refused",
  skipped: "skipped",
  failed: "failed",
  "n/a": "—",
};

function Step({ o }: { o: StepOutcome }) {
  return (
    <td className={`px-2 py-2 align-top text-xs ${TONE[o.state]}`}>
      <div className="font-medium">{LABEL[o.state]}</div>
      {o.detail?.map((d) => (
        <div key={d} className="text-[11px] text-muted-foreground">
          {d}
        </div>
      ))}
      {o.note ? <div className="mt-0.5 max-w-64 text-[11px]">{o.note}</div> : null}
    </td>
  );
}

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded border px-1 text-[10px] font-medium ${
        on ? "border-foreground/30" : "border-dashed text-muted-foreground/60 line-through"
      }`}
    >
      {label}
    </span>
  );
}

export function AddSizeFlow({
  brands,
  categories,
  initialColorwayId,
}: {
  brands: { id: string; name: string }[];
  categories: { id: string; name: string; depth: number }[];
  initialColorwayId: string | null;
}) {
  // --- 1. Find the product ---------------------------------------------------
  const [q, setQ] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [results, setResults] = useState<{ rows: AddSizeSearchRow[]; truncated: boolean } | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!q.trim() && !brandId && !categoryId) {
      setResults(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = new URLSearchParams({ q, brandId, categoryId });
        const res = await fetch(`/api/catalog/variants/add-size/search?${qs}`, { signal: ctl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setResults(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, brandId, categoryId]);

  // --- 2. The picked product ---------------------------------------------------
  const [ctx, setCtx] = useState<AddSizeContext | null>(null);
  const [systemId, setSystemId] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // entry ids, in size order
  const [barcodes, setBarcodes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function open(colorwayId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/variants/add-size/context?colorwayId=${encodeURIComponent(colorwayId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCtx(data);
      setSystemId((prev) =>
        (data as AddSizeContext).systems.some((s) => s.id === prev) ? prev : ((data as AddSizeContext).systems[0]?.id ?? "")
      );
      setReport(null);
      setConfirming(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialColorwayId) void open(initialColorwayId);
  }, [initialColorwayId]);

  function reset() {
    setCtx(null);
    setPicked([]);
    setBarcodes({});
    setReport(null);
    setConfirming(false);
  }

  const system = ctx?.systems.find((s) => s.id === systemId) ?? null;
  const pickedOptions = useMemo(
    () => (system ? system.options.filter((o) => picked.includes(o.entryId)) : []),
    [system, picked]
  );

  function toggle(entryId: string) {
    setPicked((p) => (p.includes(entryId) ? p.filter((x) => x !== entryId) : [...p, entryId]));
  }

  // --- 3. Check, then save and push ------------------------------------------
  const [report, setReport] = useState<AddSizeReport | null>(null);
  const [reportKey, setReportKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const request = useMemo(
    () => ({
      colorwayId: ctx?.colorway.id ?? "",
      sizeSystemId: systemId,
      sizes: pickedOptions.map((o) => ({ entryId: o.entryId, barcode: barcodes[o.entryId]?.trim() || null })),
    }),
    [ctx, systemId, pickedOptions, barcodes]
  );
  const key = JSON.stringify(request);
  const stale = !report || reportKey !== key || !report.dryRun;
  const localErrors = pickedOptions
    .map((o) => {
      const reason = rejectionReason(barcodes[o.entryId] ?? "");
      return reason ? `${o.sizeLabel}: barcode ${reason}` : null;
    })
    .filter((x): x is string => !!x);

  // What the last save sent. After a save the new sizes leave the picker, so a
  // retry cannot be rebuilt from it — and the server needs nothing else: apply
  // skips the master row and every channel that already holds the size.
  const [lastApplied, setLastApplied] = useState<typeof request | null>(null);

  async function post(dryRun: boolean, body: typeof request = request): Promise<AddSizeReport | null> {
    const res = await fetch("/api/catalog/variants/add-size", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, dryRun }),
    });
    let data: AddSizeReport & { error?: string };
    try {
      data = await res.json();
    } catch {
      throw new Error(`HTTP ${res.status} — the server did not answer with JSON`);
    }
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  async function check() {
    setBusy("Checking Shopify, Sitoo and Loom…");
    setConfirming(false);
    try {
      const r = await post(true);
      setReport(r);
      setReportKey(key);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function apply(body: typeof request = request) {
    setConfirming(false);
    setLastApplied(body);
    setBusy("Creating the size and pushing it to Shopify and Sitoo…");
    try {
      const r = await post(false, body);
      if (!r) return;
      setReport(r);
      setReportKey(key);
      if (r.errors.length) {
        toast.error("Nothing was saved — see the errors");
        return;
      }

      // Loom last, one send per season; a fresh delivery id per apply so a
      // retry after a failed job is not deduped into the failure.
      const applyId = Date.now().toString(36);
      let loom: StepOutcome = r.loom;
      for (const g of r.loomGroups) {
        setBusy(`Sending the colourway to Loom (${g.seasonCode})…`);
        try {
          const res = await fetch("/api/catalog/push/loom", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              colorwayIds: g.colorwayIds,
              seasonCode: g.seasonCode,
              mode: "data",
              eventId: `origio-add-size-${g.seasonCode.toLowerCase()}-${applyId}`,
            }),
          });
          const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          const skipped = (data.skipped ?? []) as { reason: string }[];
          const itemErrors: unknown[] = data.job?.itemErrors ?? [];
          const next: StepOutcome = skipped.length
            ? { state: "refused", note: `${g.seasonCode}: ${skipped[0].reason}` }
            : !res.ok || data.error
              ? { state: "failed", note: data.error ?? data.job?.fatalError ?? `HTTP ${res.status}` }
              : itemErrors.length
                ? { state: "failed", note: `${g.seasonCode}: Loom reported ${itemErrors.length} item error(s) — job ${data.jobId}` }
                : {
                    state: "written",
                    note: `${g.seasonCode}: ${data.job?.unconfirmed ? `sent; job ${data.jobId} not settled yet` : `job ${data.jobId ?? "?"}`}`,
                  };
          // Two seasons are two sends; keep the worse outcome, and every note.
          loom =
            loom.state === "failed" || loom.state === "refused"
              ? { ...loom, note: [loom.note, next.note].filter(Boolean).join(" · ") }
              : loom.state === "written"
                ? { ...next, note: [loom.note, next.note].filter(Boolean).join(" · ") }
                : next;
        } catch (e) {
          loom = { state: "failed", note: (e as Error).message };
        }
      }
      const final = { ...r, loom };
      setReport(final);

      const failed =
        final.rows.some((x) => [x.master, x.shopify, x.sitoo].some((o) => o.state === "failed")) ||
        loom.state === "failed";
      if (failed) toast.error("Saved, but a channel failed — see the report. Running it again retries only what is missing.");
      else toast.success(`${final.rows.length === 1 ? "Size" : `${final.rows.length} sizes`} added`);
      // Refresh the product so the new sizes show among the existing ones.
      if (ctx) {
        const res = await fetch(`/api/catalog/variants/add-size/context?colorwayId=${encodeURIComponent(ctx.colorway.id)}`);
        if (res.ok) setCtx(await res.json());
      }
      setPicked([]);
      setBarcodes({});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const writes = report
    ? {
        shopify: report.rows.filter((r) => r.shopify.state === "write").length,
        sitoo: report.rows.filter((r) => r.sitoo.state === "write").length,
        loom: report.loomGroups.length,
      }
    : null;

  // --- render ------------------------------------------------------------------
  if (!ctx)
    return (
      <section className="mt-6">
        <div className="flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="Style, colour, SKU or barcode — e.g. Hestra Robert, EXT-PNT-BCK"
            className="min-w-64 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {"  ".repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          {loading || searching ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
          {!results && !searching ? (
            <p className="text-sm text-muted-foreground">
              Search, or pick a brand or category. External brands only — Livid sizes come from Threadflow.
            </p>
          ) : null}
          {results && !results.rows.length && !searching ? (
            <p className="text-sm text-muted-foreground">Nothing matches.</p>
          ) : null}
          {results?.rows.length ? (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Brand · category</th>
                    <th className="px-3 py-2 font-medium">Sizes today</th>
                    <th className="px-3 py-2 font-medium">Live in</th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((r) => (
                    <tr
                      key={r.colorwayId}
                      onClick={() => open(r.colorwayId)}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.title}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{r.colorwaySku}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.brand ?? "—"}
                        {r.category ? ` · ${r.category}` : ""}
                        {r.seasons.length ? <div>{r.seasons.join(", ")}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.sizes.join(" · ") || "none"}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Chip on={r.shopify} label="Shopify" />
                          <Chip on={r.sitoo} label="Sitoo" />
                          <Chip on={r.loom} label="Loom" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.truncated ? (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing the first {results.rows.length}. Narrow the search to see the rest.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    );

  return (
    <section className="mt-6 space-y-6">
      {/* The product */}
      <div className="rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{ctx.colorway.title}</h2>
            <p className="font-mono text-xs text-muted-foreground">{ctx.colorway.colorwaySku}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ctx.colorway.brand ?? "—"}
              {ctx.colorway.category ? ` · ${ctx.colorway.category}` : ""}
              {ctx.colorway.seasons.length ? ` · ${ctx.colorway.seasons.join(", ")}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip on={ctx.channels.shopify} label="Shopify" />
            <Chip on={ctx.channels.sitoo} label="Sitoo" />
            <Chip on={ctx.channels.loom} label="Loom" />
            <Button variant="outline" size="sm" onClick={reset} disabled={!!busy}>
              Pick another
            </Button>
          </div>
        </div>
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Size</th>
              <th className="py-1 pr-3 font-medium">SKU</th>
              <th className="py-1 pr-3 font-medium">Barcode</th>
              <th className="py-1 font-medium">Linked</th>
            </tr>
          </thead>
          <tbody>
            {ctx.variants.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="py-1 pr-3 font-medium">{v.sizeLabel}</td>
                <td className="py-1 pr-3 font-mono">{v.variantSku}</td>
                <td className="py-1 pr-3 font-mono">{v.barcode ?? <span className="text-muted-foreground">none</span>}</td>
                <td className="py-1">
                  <div className="flex gap-1">
                    <Chip on={v.shopify} label="Shopify" />
                    <Chip on={v.sitoo} label="Sitoo" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ctx.refusal ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          {ctx.refusal}{" "}
          <Link href="/catalog/size-systems" className="underline underline-offset-4">
            Size systems
          </Link>
        </div>
      ) : system ? (
        <>
          {/* The size */}
          <div className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Size</h3>
                <p className="text-xs text-muted-foreground">
                  From{" "}
                  {ctx.systems.length > 1 ? (
                    <select
                      value={systemId}
                      onChange={(e) => {
                        setSystemId(e.target.value);
                        setPicked([]);
                      }}
                      className="rounded border bg-background px-1 py-0.5 text-xs"
                    >
                      {ctx.systems.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-medium text-foreground">{system.name}</span>
                  )}{" "}
                  — {system.reason}.
                </p>
              </div>
              <Link
                href="/catalog/size-systems"
                target="_blank"
                className="text-xs text-muted-foreground underline underline-offset-4"
              >
                Size missing? Add it to {system.name}
              </Link>
            </div>

            {system.skuNote ? (
              <p
                className={`mt-2 text-xs ${system.skuStem ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}
              >
                {system.skuNote}
              </p>
            ) : null}

            {system.skuStem ? (
              system.options.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {system.options.map((o) => {
                    const on = picked.includes(o.entryId);
                    return (
                      <button
                        key={o.entryId}
                        type="button"
                        onClick={() => toggle(o.entryId)}
                        disabled={!!o.taken || !!busy}
                        title={o.taken ? `${o.sku} is already on ${o.taken}` : o.sku}
                        className={`rounded-md border px-2.5 py-1 text-sm transition-colors disabled:opacity-40 ${
                          on ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
                        }`}
                      >
                        {o.sizeLabel}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  This product already has every size in {system.name}.
                </p>
              )
            ) : null}

            {pickedOptions.length ? (
              <table className="mt-4 w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Size</th>
                    <th className="py-1 pr-3 font-medium">SKU</th>
                    <th className="py-1 font-medium">Barcode — optional, strongly recommended</th>
                  </tr>
                </thead>
                <tbody>
                  {pickedOptions.map((o) => {
                    const value = barcodes[o.entryId] ?? "";
                    const reason = rejectionReason(value);
                    return (
                      <tr key={o.entryId} className="border-t">
                        <td className="py-2 pr-3 font-medium">{o.sizeLabel}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{o.sku}</td>
                        <td className="py-2">
                          <input
                            value={value}
                            onChange={(e) => setBarcodes((b) => ({ ...b, [o.entryId]: e.target.value }))}
                            inputMode="numeric"
                            placeholder="EAN-13 from the label or supplier"
                            className={`w-56 rounded-md border bg-background px-2 py-1 font-mono text-sm ${
                              reason ? "border-destructive" : ""
                            }`}
                          />
                          {reason ? (
                            <div className="text-[11px] text-destructive">{reason}</div>
                          ) : !value.trim() ? (
                            <div className="text-[11px] text-amber-700 dark:text-amber-400">
                              No barcode: the till cannot scan it until one is added.
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>

          {/* Check, then save */}
          {pickedOptions.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={check} disabled={!!busy || localErrors.length > 0}>
                Check
              </Button>
              {confirming && writes ? (
                <>
                  <Button onClick={() => apply()} disabled={!!busy}>
                    Yes — create {pickedOptions.length === 1 ? "it" : `all ${pickedOptions.length}`} and push
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={!!busy}>
                    Cancel
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Writes the master, then {writes.shopify} to Shopify, {writes.sitoo} to Sitoo
                    {writes.loom ? `, and re-sends the colourway to Loom` : ""}.
                  </span>
                </>
              ) : (
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={!!busy || stale || (report?.errors.length ?? 0) > 0}
                  title={
                    stale
                      ? "Check first — the save runs exactly what the check showed"
                      : report?.errors.length
                        ? "Fix the errors first"
                        : undefined
                  }
                >
                  Save and push
                </Button>
              )}
              {busy ? <span className="text-sm text-muted-foreground">{busy}</span> : null}
              {!busy && stale && !localErrors.length ? (
                <span className="text-xs text-muted-foreground">Check first — nothing is written by it.</span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {report ? (
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h3 className="text-sm font-semibold">{report.dryRun ? "What saving will do" : "What happened"}</h3>
            {!report.dryRun ? (
              <div className="flex items-center gap-3">
                {lastApplied &&
                (report.rows.some((x) => [x.shopify, x.sitoo].some((o) => o.state === "failed")) ||
                  report.loom.state === "failed") ? (
                  <Button size="sm" variant="outline" onClick={() => apply(lastApplied)} disabled={!!busy}>
                    Retry what failed
                  </Button>
                ) : null}
                <Link href="/catalog/variants" className="text-xs underline underline-offset-4">
                  Variant editor
                </Link>
              </div>
            ) : null}
          </div>
          {report.errors.length ? (
            <ul className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {report.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {report.warnings.length ? (
            <ul className="border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <table className="w-full">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Size</th>
                <th className="px-2 py-1.5 font-medium">Master</th>
                <th className="px-2 py-1.5 font-medium">Shopify</th>
                <th className="px-2 py-1.5 font-medium">Sitoo</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.sku} className="border-t">
                  <td className="px-2 py-2 align-top text-sm">
                    <div className="font-medium">{r.sizeLabel}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.sku}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.barcode ?? "no barcode"}</div>
                    {report.dryRun && !r.barcode && r.shopify.suggestBarcode ? (
                      <button
                        type="button"
                        onClick={() => {
                          const opt = pickedOptions.find((o) => o.sku === r.sku);
                          if (opt) setBarcodes((b) => ({ ...b, [opt.entryId]: r.shopify.suggestBarcode! }));
                        }}
                        className="mt-1 text-[11px] underline underline-offset-2"
                      >
                        Use Shopify&apos;s {r.shopify.suggestBarcode}
                      </button>
                    ) : null}
                  </td>
                  <Step o={r.master} />
                  <Step o={r.shopify} />
                  <Step o={r.sitoo} />
                </tr>
              ))}
            </tbody>
          </table>
          <div className={`border-t px-4 py-2 text-xs ${TONE[report.loom.state]}`}>
            <span className="font-medium">Loom: {LABEL[report.loom.state]}</span>
            {report.loom.note ? <span> — {report.loom.note}</span> : null}
            {report.loom.detail?.map((d) => (
              <div key={d} className="text-muted-foreground">
                {d}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
