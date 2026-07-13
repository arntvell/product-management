"use client";

import { useState } from "react";
import { toast } from "sonner";
import { catalogImageSrc } from "@/lib/catalog-image";
import type { PublishingRow } from "@/lib/master/queries";

export function PublishingTable({ rows }: { rows: PublishingRow[] }) {
  const [items, setItems] = useState<PublishingRow[]>(rows);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(row: PublishingRow, channel: "SHOPIFY" | "LOOM") {
    const key = `${row.id}:${channel}`;
    setBusy(key);
    const wantShopify = channel === "SHOPIFY" ? !row.shopify.targeted : row.shopify.targeted;
    const wantLoom = channel === "LOOM" ? !row.loom.targeted : row.loom.targeted;
    try {
      const res = await fetch(`/api/catalog/colorways/${row.id}/channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: { SHOPIFY: wantShopify, LOOM: wantLoom } }),
      });
      if (!res.ok) throw new Error("Failed");
      setItems((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                shopify: { ...r.shopify, targeted: wantShopify },
                loom: { ...r.loom, targeted: wantLoom },
              }
            : r
        )
      );
    } catch {
      toast.error("Couldn't update channel");
    } finally {
      setBusy(null);
    }
  }

  const counts = {
    shopify: items.filter((r) => r.shopify.targeted).length,
    loom: items.filter((r) => r.loom.targeted).length,
  };

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        {items.length} products · {counts.shopify} → Shopify · {counts.loom} → Loom.
        Tick a channel to target it; the actual push happens separately.
      </p>
      <div className="mt-5 overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-12 p-3"></th>
              <th className="p-3">Product</th>
              <th className="w-28 p-3 text-center">Shopify</th>
              <th className="w-28 p-3 text-center">Loom</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const src = catalogImageSrc(r.thumbnailRef);
              return (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="p-2">
                    <div className="h-9 w-9 overflow-hidden rounded bg-muted">
                      {src && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <a href={`/catalog/colorways/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </a>
                    <div className="text-xs text-muted-foreground">{r.styleName}</div>
                  </td>
                  <ChannelCell
                    state={r.shopify}
                    busy={busy === `${r.id}:SHOPIFY`}
                    onToggle={() => toggle(r, "SHOPIFY")}
                  />
                  <ChannelCell
                    state={r.loom}
                    busy={busy === `${r.id}:LOOM`}
                    onToggle={() => toggle(r, "LOOM")}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ChannelCell({
  state,
  busy,
  onToggle,
}: {
  state: { targeted: boolean; published: boolean };
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <td className="p-3 text-center">
      <label className="inline-flex flex-col items-center gap-0.5">
        <input type="checkbox" checked={state.targeted} disabled={busy} onChange={onToggle} />
        {state.targeted && (
          <span className="text-[10px] text-muted-foreground">
            {state.published ? "published" : "targeted"}
          </span>
        )}
      </label>
    </td>
  );
}
