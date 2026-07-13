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
  PRODUCT_STATUSES,
  SPLIT_TEXT_FIELDS,
  type ChannelKey,
  type ProductStatusValue,
  type SplitFieldKey,
} from "@/lib/master/fields";

type BaseValues = Record<SplitFieldKey, string>;
type Overrides = Record<ChannelKey, Partial<Record<SplitFieldKey, string>>>;
type Layer = "BASE" | ChannelKey;

export interface ColorwayEditorProps {
  colorwayId: string;
  header: { name: string; colorwaySku: string; styleName: string; styleId: string };
  initialProps: {
    status: ProductStatusValue;
    tags: string[];
    vendor: string;
    productType: string;
  };
  initialBase: BaseValues;
  initialOverrides: Overrides;
}

export function ColorwayEditor({
  colorwayId,
  header,
  initialProps,
  initialBase,
  initialOverrides,
}: ColorwayEditorProps) {
  const router = useRouter();
  const [props, setProps] = useState(initialProps);
  const [tagsText, setTagsText] = useState(initialProps.tags.join(", "));
  const [base, setBase] = useState<BaseValues>(initialBase);
  const [overrides, setOverrides] = useState<Overrides>(initialOverrides);
  const [layer, setLayer] = useState<Layer>("BASE");
  const [saving, setSaving] = useState(false);

  function setOverride(channel: ChannelKey, field: SplitFieldKey, value: string) {
    setOverrides((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], [field]: value },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        props: {
          status: props.status,
          tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          vendor: props.vendor || null,
          productType: props.productType || null,
        },
        base,
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

      {/* Product properties */}
      <section className="mt-8 space-y-4 rounded-lg border p-5">
        <h2 className="text-sm font-semibold">Product properties</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select
              value={props.status}
              onChange={(e) =>
                setProps((p) => ({
                  ...p,
                  status: e.target.value as ProductStatusValue,
                }))
              }
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
            <Input
              value={props.vendor}
              onChange={(e) => setProps((p) => ({ ...p, vendor: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Product type</Label>
            <Input
              value={props.productType}
              onChange={(e) =>
                setProps((p) => ({ ...p, productType: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tags (comma-separated)</Label>
            <Input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Enrichment with channel-split */}
      <section className="mt-6 rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Descriptions</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Edit the shared <span className="font-medium">Base</span> copy, then
          override per channel where B2B and B2C should differ. Empty channel
          fields inherit the base value.
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
          {SPLIT_TEXT_FIELDS.map((f) => {
            const isBase = layer === "BASE";
            const channel = layer as ChannelKey;
            const baseVal = base[f.key] ?? "";
            const value = isBase ? baseVal : overrides[channel]?.[f.key] ?? "";
            const overriding = !isBase && value.trim().length > 0;
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{f.label}</Label>
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
                    onChange={(e) =>
                      isBase
                        ? setBase((b) => ({ ...b, [f.key]: e.target.value }))
                        : setOverride(channel, f.key, e.target.value)
                    }
                  />
                ) : (
                  <Input
                    value={value}
                    placeholder={isBase ? undefined : baseVal || "(no base value)"}
                    onChange={(e) =>
                      isBase
                        ? setBase((b) => ({ ...b, [f.key]: e.target.value }))
                        : setOverride(channel, f.key, e.target.value)
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
