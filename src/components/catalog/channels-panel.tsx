"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CHANNELS, CHANNEL_LABELS, type ChannelKey } from "@/lib/master/fields";

interface Publication {
  channel: string;
  published: boolean;
  externalId: string | null;
  lastPushedAt: string | null;
  lastPushStatus: string | null;
}

interface Preview {
  action: "create" | "update";
  externalId: string | null;
  product: {
    title: string;
    handle: string;
    vendor: string | null;
    productType: string | null;
    status: string;
    tags: string[];
  };
  metafields: { key: string; type: string; value: string }[];
  variants: { sku: string; barcode: string | null; size: string; price: string | null }[];
  media: string[];
  roleMedia: { flat: string[]; men: string[]; women: string[] };
  warnings: string[];
}

export function ChannelsPanel({
  colorwayId,
  initialPublications,
}: {
  colorwayId: string;
  initialPublications: Publication[];
}) {
  const [pubs, setPubs] = useState<Publication[]>(initialPublications);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const targeted = (c: ChannelKey) => pubs.some((p) => p.channel === c);
  const pubFor = (c: ChannelKey) => pubs.find((p) => p.channel === c);

  async function toggle(channel: ChannelKey) {
    const next: Record<ChannelKey, boolean> = {
      SHOPIFY: targeted("SHOPIFY"),
      LOOM: targeted("LOOM"),
    };
    next[channel] = !next[channel];
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/colorways/${colorwayId}/channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPubs(data.publications);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update channels");
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview() {
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/catalog/colorways/${colorwayId}/publish-preview`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setPreview(data.preview);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl px-6">
      <section className="rounded-lg border p-5">
        <h2 className="text-sm font-semibold">Channels</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose where this product publishes. Pushing to the channel is done
          separately (Phase 3) — this sets the target.
        </p>
        <div className="mt-3 space-y-2">
          {CHANNELS.map((c) => {
            const pub = pubFor(c);
            return (
              <label key={c} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={targeted(c)}
                  disabled={saving}
                  onChange={() => toggle(c)}
                />
                <span className="font-medium">{CHANNEL_LABELS[c]}</span>
                {pub && (
                  <span className="text-xs text-muted-foreground">
                    {pub.published ? "published" : "targeted (not pushed)"}
                    {pub.externalId ? ` · ${pub.externalId.slice(0, 24)}…` : ""}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {targeted("SHOPIFY") && (
          <div className="mt-4 border-t pt-4">
            <Button variant="outline" size="sm" onClick={loadPreview} disabled={loadingPreview}>
              {loadingPreview ? "Computing…" : "Preview Shopify push"}
            </Button>
            <span className="ml-2 text-xs text-muted-foreground">
              Dry-run — shows what would be sent. Nothing is written.
            </span>
          </div>
        )}

        {preview && (
          <div className="mt-4 space-y-3 rounded-md border bg-muted/30 p-4 text-xs">
            <div className="font-medium">
              Would {preview.action} product
              {preview.externalId ? ` (${preview.externalId})` : ""}
            </div>
            {preview.warnings.length > 0 && (
              <ul className="list-disc pl-4 text-amber-600 dark:text-amber-500">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Title</dt><dd>{preview.product.title}</dd>
              <dt className="text-muted-foreground">Handle</dt><dd className="font-mono">{preview.product.handle}</dd>
              <dt className="text-muted-foreground">Vendor</dt><dd>{preview.product.vendor ?? "—"}</dd>
              <dt className="text-muted-foreground">Type</dt><dd>{preview.product.productType ?? "—"}</dd>
              <dt className="text-muted-foreground">Status</dt><dd>{preview.product.status}</dd>
              <dt className="text-muted-foreground">Tags</dt><dd>{preview.product.tags.join(", ") || "—"}</dd>
            </dl>
            <div>
              <div className="font-medium">Metafields ({preview.metafields.length})</div>
              <div className="mt-1 space-y-0.5">
                {preview.metafields.map((m) => (
                  <div key={m.key} className="font-mono">
                    custom.{m.key}{" "}
                    <span className="text-muted-foreground">({m.type})</span>:{" "}
                    {m.value.length > 60 ? m.value.slice(0, 60) + "…" : m.value}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-medium">
                Variants ({preview.variants.length}) · Gallery media ({preview.media.length})
              </div>
              <div className="mt-1 font-mono text-muted-foreground">
                {preview.variants.slice(0, 8).map((v) => `${v.size}${v.price ? ` @${v.price}` : ""}`).join("  ")}
                {preview.variants.length > 8 ? " …" : ""}
              </div>
              {(preview.roleMedia.flat.length + preview.roleMedia.men.length + preview.roleMedia.women.length) > 0 && (
                <div className="mt-1 text-muted-foreground">
                  File metafields from media roles → custom.flat ({preview.roleMedia.flat.length}),
                  men_images ({preview.roleMedia.men.length}), women_images ({preview.roleMedia.women.length})
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
