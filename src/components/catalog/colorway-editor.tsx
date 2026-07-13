"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CHANNELS,
  CHANNEL_LABELS,
  OVERRIDE_FIELDS,
  PRODUCT_STATUSES,
  SPLIT_FIELD_KEYS,
  type ChannelKey,
  type ProductStatusValue,
} from "@/lib/master/fields";

type Values = Record<string, string>;
type Overrides = Record<ChannelKey, Values>;
type Layer = "BASE" | ChannelKey;

export interface ColorwayEditorProps {
  colorwayId: string;
  source: string;
  header: { name: string; colorwaySku: string; styleName: string; styleId: string };
  initialProps: {
    status: ProductStatusValue;
    tags: string[];
    vendor: string;
    productType: string;
  };
  initialBase: Values; // the five text fields
  initialOverrides: Overrides; // per channel; keys may include "tags"
}

export function ColorwayEditor({
  colorwayId,
  source,
  header,
  initialProps,
  initialBase,
  initialOverrides,
}: ColorwayEditorProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!confirm(`Delete "${header.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/catalog/colorways/${colorwayId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Delete failed (${res.status})`);
      toast.success("Product removed");
      router.push("/catalog/styles");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }
  const [status, setStatus] = useState(initialProps.status);
  const [vendor, setVendor] = useState(initialProps.vendor);
  const [productType, setProductType] = useState(initialProps.productType);
  // Base values for all override fields (tags as a comma string).
  const [base, setBase] = useState<Values>({
    ...initialBase,
    tags: initialProps.tags.join(", "),
  });
  const [overrides, setOverrides] = useState<Overrides>(initialOverrides);
  const [layer, setLayer] = useState<Layer>("BASE");
  const [saving, setSaving] = useState(false);

  function setOverride(channel: ChannelKey, field: string, value: string) {
    setOverrides((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], [field]: value },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const baseText: Values = {};
      for (const k of SPLIT_FIELD_KEYS) baseText[k] = base[k] ?? "";

      const payload = {
        props: {
          status,
          tags: (base.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
          vendor: vendor || null,
          productType: productType || null,
        },
        base: baseText,
        overrides,
      };
      const res = await fetch(`/api/catalog/colorways/${colorwayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      toast.success("Saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const layers: Layer[] = ["BASE", ...CHANNELS];
  const isBase = layer === "BASE";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <a
        href={`/catalog/styles/${header.styleId}`}
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        ← {header.styleName}
      </a>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl font-semibold">{header.name}</h1>
        <span className="font-mono text-sm text-muted-foreground">
          {header.colorwaySku}
        </span>
      </div>

      {/* Product properties (always base) */}
      <section className="mt-8 space-y-4 rounded-lg border p-5">
        <h2 className="text-sm font-semibold">Product properties</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatusValue)}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Product type</Label>
            <Input
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Channel-split content: tags + descriptions */}
      <section className="mt-6 rounded-lg border p-5">
        <h2 className="text-sm font-semibold">Content</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tags and descriptions can differ per channel. Edit the shared{" "}
          <span className="font-medium">Base</span>, then override for Shopify
          (B2C) or Loom (B2B). Empty channel fields inherit the base value.
        </p>

        {/* Layer tabs */}
        <div className="mt-4 flex gap-1.5">
          {layers.map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                layer === l
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {l === "BASE" ? "Base" : CHANNEL_LABELS[l]}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          {OVERRIDE_FIELDS.map((f) => {
            const channel = layer as ChannelKey;
            const baseVal = base[f.key] ?? "";
            const value = isBase ? baseVal : overrides[channel]?.[f.key] ?? "";
            const overriding = !isBase && value.trim().length > 0;
            const onChange = (v: string) =>
              isBase
                ? setBase((b) => ({ ...b, [f.key]: v }))
                : setOverride(channel, f.key, v);
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>
                    {f.label}
                    {f.kind === "list" && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        comma-separated
                      </span>
                    )}
                  </Label>
                  {!isBase && (
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wide",
                        overriding ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {overriding ? "Overridden" : "Inherits base"}
                    </span>
                  )}
                </div>
                {f.multiline ? (
                  <Textarea
                    rows={3}
                    value={value}
                    placeholder={isBase ? undefined : baseVal || "(no base value)"}
                    onChange={(e) => onChange(e.target.value)}
                  />
                ) : (
                  <Input
                    value={value}
                    placeholder={isBase ? undefined : baseVal || "(no base value)"}
                    onChange={(e) => onChange(e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={save} disabled={saving || deleting}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {source !== "THREADFLOW" && (
          <Button
            variant="outline"
            onClick={remove}
            disabled={saving || deleting}
            className="ml-auto text-destructive"
          >
            {deleting ? "Removing…" : "Remove product"}
          </Button>
        )}
      </div>
    </div>
  );
}
