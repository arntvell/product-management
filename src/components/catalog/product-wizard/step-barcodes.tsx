"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { barcodeKey, rejectionReason } from "@/lib/master/barcode";
import type { StepProps } from "./types";

export function StepBarcodes({
  payload,
  update,
  draftId,
  revision,
  onImported,
}: StepProps & {
  draftId: string;
  revision: number;
  onImported: (payload: StepProps["payload"], revision: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const variants = payload.colorways.flatMap((cw) =>
    cw.variants.map((v) => ({ cw, v }))
  );
  const blank = variants.filter((x) => !x.v.barcode).length;

  if (!variants.length)
    return <p className="text-sm text-muted-foreground">Add sizes first.</p>;

  function setBarcode(cwKey: string, vKey: string, value: string) {
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) =>
        cw.key !== cwKey
          ? cw
          : {
              ...cw,
              variants: cw.variants.map((v) =>
                v.key !== vKey
                  ? v
                  : { ...v, barcode: value || null, barcodeSource: value ? "brand" : null }
              ),
            }
      ),
    }));
  }

  async function importCsv(file: File) {
    setBusy(true);
    try {
      const csv = await file.text();
      const res = await fetch(`/api/catalog/drafts/${draftId}/barcodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, revision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      const r = json.report;
      onImported(json.payload, json.revision);
      toast.success(
        `${r.filled} filled, ${r.unchanged} unchanged` +
          (r.cleared ? `, ${r.cleared} cleared` : "")
      );
      if (r.unknown.length)
        toast.error(`${r.unknown.length} row(s) not in this draft: ${r.unknown.slice(0, 3).join(", ")}`);
      for (const rej of r.rejected.slice(0, 5))
        toast.error(`${rej.variantSku}: ${rej.reason}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/api/catalog/drafts/${draftId}/barcodes`}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Export CSV
        </a>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Importing…" : "Import CSV"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCsv(f);
          }}
        />
        <span className="text-xs text-muted-foreground">
          {blank
            ? `${blank} of ${variants.length} still blank`
            : `all ${variants.length} have a barcode`}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Optional. External brands carry their own EAN — paste it here, or export the file,
        fill the barcode column in Excel and import it back. The export is sorted style →
        colourway → size position, so it matches a physical size run; the import joins on
        variant SKU, so sorting or filtering the file first is harmless.
      </p>

      {payload.channels.includes("LOOM") && blank ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Loom&apos;s stock registry carries barcoded variants only, so the {blank} blank
          size{blank === 1 ? "" : "s"} will not reach it until a code is filled in. The
          product is still created, and re-pushing later picks them up.
        </p>
      ) : null}

      <div className="space-y-3">
        {payload.colorways.map((cw) => (
          <div key={cw.key} className="rounded-md border">
            <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">
              {cw.name || "Unnamed"} · <code>{cw.colorwaySku}</code>
            </div>
            {cw.variants.map((v) => {
              const value = v.barcode ?? "";
              const bad = value ? !barcodeKey(value) : false;
              return (
                <div
                  key={v.key}
                  className="grid grid-cols-[5rem_1fr_11rem] items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0"
                >
                  <div className="font-medium">{v.sizeLabel}</div>
                  <code className="truncate text-xs text-muted-foreground">
                    {v.variantSku}
                  </code>
                  <div>
                    <Input
                      className={
                        "h-8 font-mono text-xs " +
                        (bad ? "border-destructive text-destructive" : "")
                      }
                      value={value}
                      inputMode="numeric"
                      placeholder="EAN-13"
                      onChange={(e) => setBarcode(cw.key, v.key, e.target.value.trim())}
                    />
                    {bad ? (
                      <p className="mt-0.5 text-[11px] text-destructive">
                        {rejectionReason(value)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
