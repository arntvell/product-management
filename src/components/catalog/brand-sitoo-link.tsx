"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { BrandSitooState } from "@/lib/master/brand-create";

/**
 * The brand's Sitoo manufacturer. A Sitoo product cannot be created without one
 * (finalize.ts), so a new brand gets it here: linked if Sitoo already has the
 * name, created in the production till if not.
 */
export function BrandSitooLink({
  brandId,
  brandName,
  initial,
}: {
  brandId: string;
  brandName: string;
  initial: BrandSitooState;
}) {
  const router = useRouter();
  const [similar, setSimilar] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(confirmSimilar: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/catalog/brands/${brandId}/sitoo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmSimilar }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sitoo link failed");
      if (!json.ok) {
        setSimilar(json.similar);
        return;
      }
      toast.success(
        json.action === "created"
          ? `Created "${json.name}" in Sitoo (${json.manufacturerId})`
          : `Linked to existing Sitoo manufacturer "${json.name}" (${json.manufacturerId})`
      );
      setSimilar([]);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sitoo link failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border p-5">
      <h2 className="text-body">Sitoo</h2>
      <p className="mt-1 text-fine text-muted-foreground">
        Sitoo files a brand as a manufacturer. Products for Sitoo cannot be created until
        the brand has one. Shopify and Loom need nothing here — they take the brand name.
      </p>
      <div className="mt-4 space-y-3">
        {initial.links.length ? (
          <p className="text-body">
            Linked to{" "}
            {initial.links.map((l) => (
              <span key={l.id}>
                {l.name} <code className="font-mono text-fine">({l.id})</code>
              </span>
            ))}
            {initial.links.length > 1 ? (
              <span className="text-fine">
                {" "}
                — more than one, so Sitoo pushes refuse. Unlink the wrong one on Brand
                identity.
              </span>
            ) : null}
          </p>
        ) : !initial.configured ? (
          <Notice title="Sitoo is not configured here">
            This environment has no Sitoo credentials, so the manufacturer cannot be created
            from here.
          </Notice>
        ) : similar.length ? (
          <Notice
            title="Sitoo has similar manufacturers"
            action={
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(true)}>
                Create &quot;{brandName}&quot; anyway
              </Button>
            }
          >
            {similar.map((s) => `${s.name} (${s.id})`).join(", ")}. If it is one of these,
            link it on Brand identity instead.
          </Notice>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={busy} onClick={() => run(false)}>
              {busy ? "Working…" : "Link or create in Sitoo"}
            </Button>
            <span className="text-fine text-muted-foreground">
              Links Sitoo&apos;s manufacturer named &quot;{brandName}&quot; if it exists,
              otherwise creates it in the live till.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
