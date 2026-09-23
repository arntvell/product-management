"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rejectionReason } from "@/lib/master/barcode";
import type {
  ChannelOutcome,
  RowPlan,
  VariantBarcodeReport,
  VariantEditorRow,
} from "@/lib/master/variant-barcodes";

type Edits = Record<string, string>;

/** "SKU  barcode" per line — tab, comma, semicolon or spaces between. */
function parsePaste(text: string): { variantSku: string; barcode: string }[] {
  const out: { variantSku: string; barcode: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\t,;]+|\s{1,}/).filter(Boolean);
    if (parts.length < 2) continue;
    // A header row ("sku, barcode") has no digits in its second column.
    if (!/\d/.test(parts[parts.length - 1])) continue;
    out.push({ variantSku: parts[0], barcode: parts[parts.length - 1] });
  }
  return out;
}

function editsKey(edits: Edits): string {
  return JSON.stringify(Object.entries(edits).sort(([a], [b]) => a.localeCompare(b)));
}

const TONE: Record<ChannelOutcome["state"], string> = {
  write: "text-blue-700 dark:text-blue-400",
  written: "text-emerald-700 dark:text-emerald-400",
  agrees: "text-muted-foreground",
  "not-live": "text-muted-foreground",
  refused: "text-amber-700 dark:text-amber-400",
  failed: "text-destructive",
  "n/a": "text-muted-foreground",
};

const LABEL: Record<ChannelOutcome["state"], string> = {
  write: "will write",
  written: "written",
  agrees: "already right",
  "not-live": "not live",
  refused: "refused",
  failed: "failed",
  "n/a": "—",
};

function Outcome({ o }: { o: ChannelOutcome }) {
  return (
    <td className={`px-2 py-1.5 text-xs ${TONE[o.state]}`} title={o.note}>
      <div className="font-medium">{LABEL[o.state]}</div>
      {o.from !== undefined && (o.state === "write" || o.state === "written") ? (
        <div className="font-mono text-[10px] text-muted-foreground">was {o.from ?? "empty"}</div>
      ) : null}
      {o.note && o.state !== "write" ? (
        <div className="max-w-48 truncate text-[10px]">{o.note}</div>
      ) : null}
    </td>
  );
}

const MASTER_LABEL: Record<RowPlan["master"], string> = {
  fill: "will fill",
  change: "will change",
  unchanged: "unchanged",
  rejected: "rejected",
  collision: "taken",
  unknown: "unknown SKU",
};

function Live({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded border px-1 text-[10px] font-medium ${
        on ? "border-foreground/30" : "border-dashed text-muted-foreground/60 line-through"
      }`}
      title={on ? `Live in ${label}` : `Not live in ${label}`}
    >
      {label}
    </span>
  );
}

export function VariantBarcodeEditor({
  initialRows,
  truncated,
  searched,
}: {
  initialRows: VariantEditorRow[];
  truncated: boolean;
  searched: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [edits, setEdits] = useState<Edits>({});
  const [paste, setPaste] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<VariantBarcodeReport | null>(null);
  const [reportKey, setReportKey] = useState<string | null>(null);

  const key = editsKey(edits);
  const pending = Object.keys(edits).length;
  const planByRow = useMemo(
    () => new Map((report?.rows ?? []).map((r) => [r.variantSku, r])),
    [report]
  );
  const previewCurrent = report?.dryRun && reportKey === key;
  const accepted = (report?.rows ?? []).filter((r) =>
    ["fill", "change", "unchanged"].includes(r.master)
  );

  function setEdit(sku: string, value: string, current: string | null) {
    setEdits((prev) => {
      const next = { ...prev };
      if (value.trim() === "" || value.trim() === (current ?? "")) delete next[sku];
      else next[sku] = value.trim();
      return next;
    });
  }

  async function applyPaste() {
    const parsed = parsePaste(paste);
    if (!parsed.length) {
      toast.error("No “SKU barcode” lines found");
      return;
    }
    setBusy("Loading pasted SKUs…");
    try {
      const missing = parsed.map((p) => p.variantSku).filter((s) => !rows.some((r) => r.variantSku === s));
      let merged = rows;
      if (missing.length) {
        const res = await fetch(`/api/catalog/variants?skus=${encodeURIComponent(missing.join(","))}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Lookup failed");
        const known = new Set(rows.map((r) => r.id));
        merged = [...rows, ...(data.rows as VariantEditorRow[]).filter((r) => !known.has(r.id))];
        setRows(merged);
      }
      const found = new Set(merged.map((r) => r.variantSku));
      const unknown = parsed.filter((p) => !found.has(p.variantSku)).map((p) => p.variantSku);
      setEdits((prev) => {
        const next = { ...prev };
        for (const p of parsed) if (found.has(p.variantSku)) next[p.variantSku] = p.barcode;
        return next;
      });
      setPaste("");
      toast.success(`${parsed.length - unknown.length} corrections added`);
      if (unknown.length) {
        toast.warning(`${unknown.length} SKU${unknown.length === 1 ? "" : "s"} not found: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function post(dryRun: boolean): Promise<VariantBarcodeReport | null> {
    const res = await fetch("/api/catalog/variants/barcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun,
        evidence,
        edits: Object.entries(edits).map(([variantSku, barcode]) => ({ variantSku, barcode })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Request failed");
      return null;
    }
    return data as VariantBarcodeReport;
  }

  async function preview() {
    setBusy("Reading Shopify, Sitoo and Loom…");
    try {
      const r = await post(true);
      if (r) {
        setReport(r);
        setReportKey(key);
      }
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!report) return;
    const count = (ch: "shopify" | "sitoo" | "loom") =>
      report.rows.filter((r) => r[ch].state === "write").length;
    const masterWrites = report.rows.filter((r) => r.master === "fill" || r.master === "change").length;
    const ok = window.confirm(
      `Write ${masterWrites} barcode${masterWrites === 1 ? "" : "s"} to the master, ` +
        `${count("shopify")} to Shopify, ${count("sitoo")} to Sitoo, and re-send ` +
        `${report.loomGroups.reduce((n, g) => n + g.colorwayIds.length, 0)} colourway(s) to Loom?\n\n` +
        `These are live systems.`
    );
    if (!ok) return;

    setBusy("Writing master, Shopify and Sitoo…");
    try {
      const r = await post(false);
      if (!r) return;
      setReport(r);
      setReportKey(key);

      // Loom last, one push per season; see variant-barcodes.ts. A fresh
      // delivery id per apply: the content-derived default makes Loom dedupe a
      // re-apply after a failed job into that job, returning its stale failure.
      const applyId = Date.now().toString(36);
      const rowsOut = r.rows.map((row) => ({ ...row }));
      for (const g of r.loomGroups) {
        setBusy(`Sending ${g.colorwayIds.length} colourway(s) to Loom (${g.seasonCode})…`);
        let outcome: (colorwayId: string) => ChannelOutcome;
        try {
          const res = await fetch("/api/catalog/push/loom", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              colorwayIds: g.colorwayIds,
              seasonCode: g.seasonCode,
              mode: "data",
              eventId: `origio-variant-editor-${g.seasonCode.toLowerCase()}-${applyId}`,
            }),
          });
          const data = await res.json();
          const skipped = new Map<string, string>(
            (data.skipped ?? []).map((s: { colorwayId: string; reason: string }) => [s.colorwayId, s.reason])
          );
          const itemErrors: unknown[] = data.job?.itemErrors ?? [];
          outcome = (id) => {
            if (skipped.has(id)) return { state: "refused", note: `${g.seasonCode}: ${skipped.get(id)}` };
            if (!res.ok || data.error) return { state: "failed", note: data.error ?? data.job?.fatalError ?? `HTTP ${res.status}` };
            if (itemErrors.length) return { state: "failed", note: `Loom job reported ${itemErrors.length} item error(s) — job ${data.jobId}` };
            if (data.job?.unconfirmed) return { state: "written", note: `sent; job ${data.jobId} not settled yet` };
            return { state: "written", note: `job ${data.jobId ?? "?"}` };
          };
        } catch (e) {
          const msg = (e as Error).message;
          outcome = () => ({ state: "failed", note: msg });
        }
        for (const row of rowsOut) {
          if (row.colorwayId && g.colorwayIds.includes(row.colorwayId)) {
            // A colourway in two seasons is pushed twice; keep the worse result.
            const next = outcome(row.colorwayId);
            if (row.loom.state !== "failed" && row.loom.state !== "refused") row.loom = next;
          }
        }
      }
      setReport({ ...r, rows: rowsOut });

      // Reflect the new master values on the page.
      const applied = new Map(
        rowsOut.filter((x) => x.master === "fill" || x.master === "change").map((x) => [x.variantSku, x.to])
      );
      setRows((prev) =>
        prev.map((row) =>
          applied.has(row.variantSku) ? { ...row, barcode: applied.get(row.variantSku) ?? row.barcode, barcodeManual: true } : row
        )
      );
      setEdits((prev) => {
        const next = { ...prev };
        for (const x of rowsOut) if (["fill", "change", "unchanged"].includes(x.master)) delete next[x.variantSku];
        return next;
      });

      const failed = rowsOut.filter((x) =>
        [x.shopify, x.sitoo, x.loom].some((o) => o.state === "failed")
      ).length;
      if (failed) toast.error(`${failed} row(s) did not reach every channel — see the report`);
      else toast.success(`Applied ${r.master.applied} barcode change(s)`);
    } finally {
      setBusy(null);
    }
  }

  const errors = report?.channelErrors ?? {};

  return (
    <div className="mt-6 space-y-4">
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Paste corrections</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          One size per line: SKU, then the correct barcode — tab, comma or space
          between. Rows not on the page are loaded.
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          placeholder={"EXT-PNT-BCK-ANTHR-M\t0884597246191\nEXT-PNT-BCK-ANTHR-L\t0884597246207"}
          className="mt-2 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
        />
        <Button size="sm" variant="outline" onClick={applyPaste} disabled={!!busy || !paste.trim()}>
          Add to editor
        </Button>
      </details>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {searched ? "Nothing matches." : "Search for a SKU, colourway or product — or paste corrections."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">Variant</th>
                <th className="px-2 py-2 font-medium">Size</th>
                <th className="px-2 py-2 font-medium">Live in</th>
                <th className="px-2 py-2 font-medium">Barcode</th>
                <th className="px-2 py-2 font-medium">New barcode</th>
                {report ? (
                  <>
                    <th className="px-2 py-2 font-medium">Master</th>
                    <th className="px-2 py-2 font-medium">Shopify</th>
                    <th className="px-2 py-2 font-medium">Sitoo</th>
                    <th className="px-2 py-2 font-medium">Loom</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const value = edits[r.variantSku] ?? "";
                const invalid = value ? rejectionReason(value) : null;
                const plan = planByRow.get(r.variantSku);
                const newGroup = i === 0 || rows[i - 1].colorwayId !== r.colorwayId;
                return (
                  <tr key={r.id} className={newGroup ? "border-t" : ""}>
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-xs">{r.variantSku}</div>
                      {newGroup ? (
                        <div className="text-xs text-muted-foreground">
                          {r.name.toLowerCase().includes(r.styleName.toLowerCase())
                            ? r.name
                            : `${r.styleName} — ${r.name}`}
                          {r.seasons.length ? ` · ${r.seasons.join(", ")}` : ""}
                          {r.status !== "ACTIVE" ? ` · ${r.status.toLowerCase()}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{r.sizeLabel}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <Live on={r.shopify} label="Shopify" />
                        <Live on={r.sitoo} label="Sitoo" />
                        <Live on={r.loom} label="Loom" />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">
                      {r.barcode ?? <span className="text-muted-foreground">—</span>}
                      {r.barcodeManual ? (
                        <span className="ml-1 text-[10px] text-muted-foreground" title="Set by hand — Threadflow will not overwrite it">
                          manual
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={value}
                        onChange={(e) => setEdit(r.variantSku, e.target.value, r.barcode)}
                        placeholder={r.barcode ?? ""}
                        inputMode="numeric"
                        className={`w-40 rounded border bg-background px-2 py-1 font-mono text-xs ${
                          invalid ? "border-destructive" : value ? "border-blue-500" : ""
                        }`}
                      />
                      {invalid ? <div className="max-w-56 text-[10px] text-destructive">{invalid}</div> : null}
                    </td>
                    {report ? (
                      plan ? (
                        <>
                          <td
                            className={`px-2 py-1.5 text-xs ${
                              ["rejected", "collision", "unknown"].includes(plan.master)
                                ? "text-destructive"
                                : plan.master === "unchanged"
                                  ? "text-muted-foreground"
                                  : "text-blue-700 dark:text-blue-400"
                            }`}
                            title={plan.note}
                          >
                            <div className="font-medium">
                              {report.dryRun ? MASTER_LABEL[plan.master] : MASTER_LABEL[plan.master].replace("will ", "") }
                            </div>
                            {plan.note ? <div className="max-w-48 truncate text-[10px]">{plan.note}</div> : null}
                          </td>
                          <Outcome o={plan.shopify} />
                          <Outcome o={plan.sitoo} />
                          <Outcome o={plan.loom} />
                        </>
                      ) : (
                        <td colSpan={4} />
                      )
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {truncated ? (
        <p className="text-xs text-muted-foreground">Showing the first 500 matches — narrow the search.</p>
      ) : null}

      {Object.entries(errors).filter(([, v]) => v).length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {Object.entries(errors).map(([ch, msg]) =>
            msg ? (
              <div key={ch}>
                <span className="font-medium capitalize">{ch}:</span> {msg}
              </div>
            ) : null
          )}
        </div>
      ) : null}
      {report?.unwound.length ? (
        <p className="text-xs text-muted-foreground">
          Rotation: {report.unwound.join(", ")} give up their current code first, so the swap can land.
        </p>
      ) : null}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
        <span className="text-sm">
          {pending} pending change{pending === 1 ? "" : "s"}
        </span>
        <input
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Evidence (optional) — e.g. supplier sheet 23.09, scanned label"
          className="w-80 rounded-md border bg-background px-3 py-1.5 text-sm"
        />
        <Button variant="outline" onClick={preview} disabled={!!busy || !pending}>
          Preview
        </Button>
        <Button onClick={apply} disabled={!!busy || !previewCurrent || !accepted.length}>
          Apply to master and channels
        </Button>
        {pending ? (
          <Button
            variant="ghost"
            onClick={() => {
              setEdits({});
              setReport(null);
            }}
            disabled={!!busy}
          >
            Discard
          </Button>
        ) : null}
        {busy ? <span className="text-sm text-muted-foreground">{busy}</span> : null}
        {pending && !previewCurrent && !busy ? (
          <span className="text-xs text-muted-foreground">Preview before applying.</span>
        ) : null}
      </div>
    </div>
  );
}
