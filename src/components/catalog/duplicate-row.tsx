"use client";

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Member {
  colorwayId: string;
  colorwaySku: string;
  source: string;
  variants: number;
  barcoded: number;
}

export interface CandidateView {
  styleName: string;
  name: string;
  color: string | null;
  confidence: "high" | "medium";
  reason: string;
  keep: Member;
  absorb: Member[];
  keepPio: number | null;
  absorbPio: Array<number | null>;
}

function Pio({ qty }: { qty: number | null }) {
  if (qty === null) return <span className="text-muted-foreground">not in Pio</span>;
  if (qty === 0) return <span className="text-muted-foreground">Pio 0</span>;
  return <span className="text-muted-foreground">Pio {qty}</span>;
}

function Side({
  member,
  pio,
  role,
}: {
  member: Member;
  pio: number | null;
  role: "keep" | "absorb";
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body">
      <Badge variant={role === "keep" ? "default" : "outline"}>{role}</Badge>
      <code>{member.colorwaySku}</code>
      <span className="text-fine text-muted-foreground">{member.source}</span>
      <span className="text-fine text-muted-foreground">
        {member.barcoded}/{member.variants} barcoded
      </span>
      <span className="text-fine">
        <Pio qty={pio} />
      </span>
    </div>
  );
}

export function DuplicateRow({ candidate: c }: { candidate: CandidateView }) {
  const [preview, setPreview] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pio disagreeing with the barcode signal is the one case worth stopping on:
  // the warehouse picks stock under the SKU this would absorb.
  const pioContradicts =
    c.keepPio !== null &&
    c.absorbPio.some((q) => q !== null && q > 0 && (c.keepPio ?? 0) === 0);

  const runPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The merge endpoint takes one loser at a time, so a group with several
      // absorbs is previewed as several plans.
      const plans = [];
      for (const a of c.absorb) {
        const res = await fetch("/api/catalog/colorways/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keepId: c.keep.colorwayId,
            loseId: a.colorwayId,
            dryRun: true,
          }),
        });
        const body = await res.json();
        if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`);
        plans.push({ lose: a.colorwaySku, plan: body });
      }
      setPreview(plans.length === 1 ? plans[0].plan : plans);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [c]);

  return (
    <div className="border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div>
            {c.styleName} — {c.name}
            {c.color ? (
              <span className="ml-2 text-fine text-muted-foreground">{c.color}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-fine text-muted-foreground">{c.reason}</p>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={runPreview}>
          {busy ? "Previewing…" : "Preview merge"}
        </Button>
      </div>

      <div className="mt-3 space-y-1.5">
        <Side member={c.keep} pio={c.keepPio} role="keep" />
        {c.absorb.map((a, i) => (
          <Side key={a.colorwayId} member={a} pio={c.absorbPio[i]} role="absorb" />
        ))}
      </div>

      {pioContradicts ? (
        <p className="mt-3 border border-ink bg-paper p-2 text-meta normal-case tracking-normal">
          The warehouse holds stock under the SKU this would absorb, and none
          under the one it would keep. Check before merging — the barcodes and
          the bins disagree.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-fine text-destructive">{error}</p>
      ) : null}
      {preview ? (
        <pre className="mt-3 max-h-64 overflow-auto bg-muted p-3 text-fine">
          {JSON.stringify(preview, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
