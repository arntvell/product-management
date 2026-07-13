"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface Preview {
  total: number;
  toImport: number;
  skipped: number;
  byVendor: { vendor: string; count: number }[];
}

export function ImportPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedCount = preview
    ? preview.byVendor
        .filter((v) => selected.has(v.vendor))
        .reduce((sum, v) => sum + v.count, 0)
    : 0;

  function toggle(vendor: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  }

  async function runPreview() {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/import/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setPreview(data);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/import/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendors: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      toast.success(`Imported ${data.imported} products (skipped ${data.skipped})`);
      setPreview(null);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-5">
      <h2 className="text-sm font-semibold">Import carry-over from Shopify</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Bring products that exist in Shopify but not yet in the master (external
        brands, carry-over goods) into the Continuity season. Products already
        here — matched by handle or SKU — are skipped, so Threadflow products are
        never duplicated.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="outline" onClick={runPreview} disabled={busy}>
          {busy ? "Working…" : "Preview"}
        </Button>
        {preview && selected.size > 0 && (
          <Button onClick={runImport} disabled={busy}>
            Import {selectedCount} products ({selected.size} vendors)
          </Button>
        )}
      </div>

      {preview && (
        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="tabular-nums">
            {preview.total} in Shopify · <b>{preview.toImport}</b> not in master
            · {preview.skipped} already here
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Pick vendors to import (the Shopify catalogue also contains vintage
            and fit-guide entries — leave those unchecked):
          </p>
          <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {preview.byVendor.map((v) => (
              <label
                key={v.vendor}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-background"
              >
                <input
                  type="checkbox"
                  checked={selected.has(v.vendor)}
                  onChange={() => toggle(v.vendor)}
                />
                <span className="truncate">{v.vendor || "(no vendor)"}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {v.count}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
