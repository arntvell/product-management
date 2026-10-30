"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCan, useCurrentUser } from "@/components/auth/current-user";
import type { StockArrival } from "@/lib/master/stock-arrivals";

interface Alert {
  id: string;
  createdAt: string;
  arrivals: StockArrival[];
}

/**
 * Stock that has arrived for products that had none, shown once to each Admin
 * and Product manager the next time they open Origo. "Got it" marks every
 * alert shown as seen; closing without it shows them again next time.
 */
export function StockAlerts() {
  const { signedIn } = useCurrentUser();
  const eligible = useCan("catalog") && signedIn;
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    let live = true;
    fetch("/api/alerts/stock")
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d: { alerts: Alert[] }) => {
        if (live && d.alerts?.length) {
          setAlerts(d.alerts);
          setOpen(true);
        }
      })
      .catch(() => {
        /* no alert this time; it stays unseen */
      });
    return () => {
      live = false;
    };
  }, [eligible]);

  async function acknowledge() {
    setOpen(false);
    try {
      const res = await fetch("/api/alerts/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertIds: alerts.map((a) => a.id) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      toast.error("Could not mark the stock alert as seen — it will show again.");
    }
  }

  const arrivals = alerts.flatMap((a) => a.arrivals);
  if (!arrivals.length) return null;
  const when = new Date(alerts[alerts.length - 1].createdAt).toLocaleString("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock arrived</DialogTitle>
          <DialogDescription>
            {arrivals.length} product{arrivals.length === 1 ? "" : "s"} that had no stock now
            {arrivals.length === 1 ? " has" : " have"} some in Loom. Last checked {when}.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto border border-line">
          {arrivals.map((a) => (
            <li key={a.colorwayId} className="flex items-baseline justify-between gap-4 px-3 py-2">
              <div className="min-w-0">
                <Link
                  href={`/catalog/colorways/${a.colorwayId}`}
                  onClick={() => setOpen(false)}
                  className="block truncate text-body hover:underline"
                >
                  {a.name.startsWith(a.styleName) ? a.name : `${a.styleName} ${a.name}`}
                </Link>
                <div className="truncate text-fine text-muted-foreground">
                  <span className="font-mono">{a.sku}</span> · {a.brand} · {a.season}
                </div>
              </div>
              <div
                className="shrink-0 text-right text-fine tabular-nums"
                title={a.locations.map((l) => `${l.location} ${l.onHand}`).join(", ")}
              >
                <div>{a.onHand} on hand</div>
                <div className="text-muted-foreground">
                  Warehouse {a.warehouse} · Stores {a.stores}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={() => void acknowledge()}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
