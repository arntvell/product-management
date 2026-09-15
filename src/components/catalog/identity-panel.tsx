"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IdentityGapCounts, IdentityGapRow } from "@/lib/master/identity-report";

export function IdentityPanel({
  counts,
  rows,
  total,
}: {
  counts: IdentityGapCounts;
  rows: IdentityGapRow[];
  total: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = rows.filter(
    (r) =>
      !q.trim() ||
      r.colorwaySku.toLowerCase().includes(q.toLowerCase()) ||
      r.name.toLowerCase().includes(q.toLowerCase())
  );

  async function repushIdentity() {
    if (!selected.size) return;
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/push/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          colorwayIds: [...selected],
          channels: ["LOOM"],
          kind: "identity-repush",
          note: "Re-send channel ids to Loom",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      const run = await fetch(`/api/catalog/push/batch/${json.batchId}/run`, {
        method: "POST",
      });
      const runJson = await run.json();
      if (!run.ok) throw new Error(runJson.error ?? "Failed");
      toast.success(`Identity sent for ${selected.size} colorway(s).`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Colorways" value={counts.colorways} />
        <Stat label="Variants" value={counts.variants} />
        <Stat
          label="No InventoryItem gid"
          value={counts.missingShopifyInventory}
          of={counts.variants}
          warn
          hint="what Loom's registry joins on"
        />
        <Stat
          label="No barcode"
          value={counts.variantsWithoutBarcode}
          of={counts.variants}
          warn
          hint="blocked from the Loom registry entirely"
        />
        <Stat
          label="No Shopify product"
          value={counts.missingShopifyProduct}
          of={counts.colorways}
        />
        <Stat
          label="No ProductVariant gid"
          value={counts.missingShopifyVariant}
          of={counts.variants}
        />
        <Stat
          label="No Sitoo product id"
          value={counts.missingSitooProduct}
          of={counts.variants}
        />
        <Stat
          label="No Loom confirmation"
          value={counts.missingLoomConfirmation}
          of={counts.colorways}
        />
      </div>

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <b>{counts.identityNotSentToLoom}</b> colorways have never had their channel ids
        transmitted to Loom. That says <b>sent</b>, not stored: Loom answered{" "}
        <code>updated: 0</code> to all 355 identity rows sent so far, so whether it keeps
        them is still unconfirmed. Nothing should depend on the inventory join until Loom
        answers that.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search SKU or name"
          className="h-8 max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          showing {filtered.length} of {total}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected.size}
            onClick={repushIdentity}
          >
            {busy ? "Sending…" : `Re-push identity to Loom (${selected.size})`}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-[52rem]">
          <div className="grid grid-cols-[2rem_minmax(14rem,2fr)_5rem_5rem_5rem_5rem_minmax(9rem,1fr)] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div />
            <div>Colorway</div>
            <div className="text-right">Sizes</div>
            <div className="text-right">Inv gid</div>
            <div className="text-right">Sitoo</div>
            <div className="text-right">Barcode</div>
            <div>Missing</div>
          </div>
          {filtered.map((r) => (
            <div
              key={r.colorwayId}
              className="grid grid-cols-[2rem_minmax(14rem,2fr)_5rem_5rem_5rem_5rem_minmax(9rem,1fr)] items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0"
            >
              <input
                type="checkbox"
                checked={selected.has(r.colorwayId)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(r.colorwayId);
                  else next.delete(r.colorwayId);
                  setSelected(next);
                }}
              />
              <div className="min-w-0">
                <code className="block truncate text-xs">{r.colorwaySku}</code>
                <div className="truncate text-[11px] text-muted-foreground">
                  {r.brand ? `${r.brand} · ` : ""}
                  {r.name}
                </div>
              </div>
              <div className="text-right tabular-nums text-muted-foreground">{r.variants}</div>
              <Frac have={r.withInventoryGid} of={r.variants} />
              <Frac have={r.withSitooId} of={r.variants} />
              <Frac have={r.withBarcode} of={r.variants} />
              <div className="truncate text-[11px] text-muted-foreground">
                {r.gaps.join(", ") || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Frac({ have, of }: { have: number; of: number }) {
  const complete = have === of;
  return (
    <div
      className={
        "text-right tabular-nums text-xs " +
        (complete ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")
      }
    >
      {have}/{of}
    </div>
  );
}

function Stat({
  label,
  value,
  of,
  hint,
  warn,
}: {
  label: string;
  value: number;
  of?: number;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "text-xl font-semibold tabular-nums " +
          (warn && value ? "text-amber-700 dark:text-amber-400" : "")
        }
      >
        {value.toLocaleString()}
        {of ? (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {((value / of) * 100).toFixed(0)}%
          </span>
        ) : null}
      </div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
