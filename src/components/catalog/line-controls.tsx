"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Inline CORE / New-vs-Carry-over editor for a product row in the Collections
// list. Each change posts to the classify endpoint, which records a MANUAL lock
// so the automatic classify pass won't revert it.
export function LineControls({
  colorwayId,
  initialIsCore,
  seasonCode,
  initialOrigin,
}: {
  colorwayId: string;
  initialIsCore: boolean;
  seasonCode?: string; // the season being viewed, if it's a real season entry
  initialOrigin: "NEW" | "CARRYOVER" | null;
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

  async function toggleOrigin() {
    if (!seasonCode || origin === null) return;
    const next = origin === "CARRYOVER" ? "NEW" : "CARRYOVER";
    setOrigin(next);
    if (!(await post({ seasonCode, origin: next }))) setOrigin(origin);
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
          isCore
            ? "bg-foreground text-background"
            : "border text-muted-foreground hover:bg-muted"
        )}
      >
        ★ Core
      </button>
      {origin !== null && (
        <button
          type="button"
          onClick={toggleOrigin}
          disabled={busy}
          title="Toggle New / Carry-over for this season"
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
    </div>
  );
}
