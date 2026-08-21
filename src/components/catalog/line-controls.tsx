"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Inline editor for a product row in the Collections list: CORE flag, New vs
// Carry-over for the target season (creating the season entry if the product
// isn't in it yet), and a read-only Sale badge. Each change posts to the
// classify endpoint, which records a MANUAL lock so the auto classify pass
// won't revert it.
export function LineControls({
  colorwayId,
  initialIsCore,
  targetSeason,
  initialOrigin,
  onSale,
}: {
  colorwayId: string;
  initialIsCore: boolean;
  targetSeason: string;
  initialOrigin: "NEW" | "CARRYOVER" | null;
  onSale: boolean;
}) {
  const [isCore, setIsCore] = useState(initialIsCore);
  const [origin, setOrigin] = useState<"NEW" | "CARRYOVER" | null>(initialOrigin);
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/catalog/colorways/${colorwayId}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggleCore() {
    const next = !isCore;
    setIsCore(next);
    if (!(await post({ isCore: next }))) setIsCore(!next);
    else toast.success(next ? "Marked as Core" : "Removed from Core");
  }

  async function setOriginTo(next: "NEW" | "CARRYOVER") {
    const prev = origin;
    setOrigin(next);
    if (!(await post({ seasonCode: targetSeason, origin: next }))) setOrigin(prev);
    else if (prev === null)
      toast.success(`Carried over into ${targetSeason}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={toggleCore}
        disabled={busy}
        title={isCore ? "Core line — click to unset" : "Mark as Core line"}
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors disabled:opacity-50",
          isCore ? "bg-foreground text-background" : "border text-muted-foreground hover:bg-muted"
        )}
      >
        ★ Core
      </button>

      {origin === null ? (
        <button
          type="button"
          onClick={() => setOriginTo("CARRYOVER")}
          disabled={busy}
          title={`Carry this product over into ${targetSeason}`}
          className="rounded border border-dashed px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          + Carry over
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOriginTo(origin === "CARRYOVER" ? "NEW" : "CARRYOVER")}
          disabled={busy}
          title={`${targetSeason}: toggle New / Carry-over`}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors disabled:opacity-50",
            origin === "CARRYOVER"
              ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-500"
              : "bg-green-500/15 text-green-700 hover:bg-green-500/25 dark:text-green-500"
          )}
        >
          {origin === "CARRYOVER" ? "Carry-over" : "New"}
        </button>
      )}

      {onSale && (
        <span
          title="On sale (has a SALE tag)"
          className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-400"
        >
          Sale
        </span>
      )}
    </div>
  );
}
