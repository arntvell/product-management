"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Action {
  key: string;
  label: string;
  endpoint: string;
  /** Every action previews first; apply is a second, deliberate click. */
  note: string;
}

const ACTIONS: Action[] = [
  {
    key: "kind",
    label: "Classify product kind",
    endpoint: "/api/catalog/classify-kind",
    note: "Check the examples: individual IMP- garments must stay merchandise, only LIV-IMP-*-OS buckets become aggregate.",
  },
  {
    key: "sitoo",
    label: "Link Sitoo",
    endpoint: "/api/catalog/sitoo/link",
    note: "Matches by SKU then barcode. Creates nothing in Sitoo.",
  },
  {
    key: "shopify",
    label: "Link Shopify",
    endpoint: "/api/catalog/shopify/link",
    note: "Archived products are excluded — 7,523 SKUs exist only on archived records.",
  },
  {
    key: "push-sitoo",
    label: "Push barcodes to Sitoo",
    endpoint: "/api/catalog/push/sitoo",
    note: "Point SITOO_BASE_URL at the sandbox first. Rotated size runs are unwound before rewriting.",
  },
  {
    key: "push-shopify",
    label: "Push barcodes to Shopify",
    endpoint: "/api/catalog/push/shopify/barcodes",
    note: "Shopify does not enforce barcode uniqueness, so the plan refuses anything that would duplicate a code.",
  },
];

type Outcome = { dryRun: boolean; body: unknown; error?: string };

export function CutoverPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const run = useCallback(
    async (action: Action, dryRun: boolean) => {
      setBusy(`${action.key}:${dryRun ? "preview" : "apply"}`);
      try {
        const res = await fetch(action.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun }),
        });
        const body = await res.json();
        setOutcomes((o) => ({
          ...o,
          [action.key]: { dryRun, body, error: res.ok ? undefined : body?.error },
        }));
        if (!dryRun && res.ok) router.refresh();
      } catch (e) {
        setOutcomes((o) => ({
          ...o,
          [action.key]: { dryRun, body: null, error: (e as Error).message },
        }));
      } finally {
        setBusy(null);
      }
    },
    [router]
  );

  return (
    <div className="space-y-3">
      {ACTIONS.map((a) => {
        const outcome = outcomes[a.key];
        return (
          <div key={a.key} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{a.label}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.note}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run(a, true)}
                >
                  {busy === `${a.key}:preview` ? "Previewing…" : "Preview"}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || !outcome || outcome.dryRun === false}
                  onClick={() => run(a, false)}
                  title={
                    outcome
                      ? "Apply what the preview showed"
                      : "Preview first — every one of these writes to a live system"
                  }
                >
                  {busy === `${a.key}:apply` ? "Applying…" : "Apply"}
                </Button>
              </div>
            </div>

            {outcome ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={outcome.error ? "destructive" : "secondary"}>
                    {outcome.error ? "failed" : outcome.dryRun ? "preview" : "applied"}
                  </Badge>
                  {outcome.error ? (
                    <span className="text-xs text-destructive">{outcome.error}</span>
                  ) : null}
                </div>
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                  {JSON.stringify(outcome.body, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
