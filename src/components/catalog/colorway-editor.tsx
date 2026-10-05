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
import { channelProductTitle } from "@/lib/master/channel-title";

type Values = Record<string, string>;
type Overrides = Record<ChannelKey, Values>;
type Layer = "BASE" | ChannelKey;

export interface SeasonPrice {
  seasonId: string;
  code: string;
  /** NOK MSRP as typed, or "" where this season has no price row. */
  amount: string;
}

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
  /** How many colourways share this style. 1 means the style is this product. */
  styleColorwayCount: number;
  /** One row per season the product is in; may be empty. */
  initialPrices: SeasonPrice[];
  /** Channels this product is actually on — which systems a save has to reach. */
  targetedChannels: string[];
}

export function ColorwayEditor({
  colorwayId,
  source,
  header,
  initialProps,
  initialBase,
  initialOverrides,
  styleColorwayCount,
  initialPrices,
  targetedChannels,
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
  const [name, setName] = useState(header.name);
  const [styleName, setStyleName] = useState(header.styleName);
  const [prices, setPrices] = useState<SeasonPrice[]>(initialPrices);

  // The style may be renamed from here only when it IS this product. With
  // siblings, the same edit would rename them too.
  const ownsStyle = styleColorwayCount === 1;

  // What Shopify and the till will be called after a save. Shown rather than
  // explained: the composition rule (name alone when it already starts with the
  // style, "<style> <name>" otherwise) is where a half-rename goes wrong, and
  // seeing "Sunglasses Ray-Ban Aviator" before saving is the whole guard.
  const composedTitle = channelProductTitle({
    name: name.trim(),
    style: { styleName: (ownsStyle ? styleName : header.styleName).trim() },
  });
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
        identity: {
          name,
          // Omitted entirely when the style is shared, so a save from this page
          // can never reach another colourway's name.
          ...(ownsStyle ? { styleName } : {}),
        },
        prices: Object.fromEntries(prices.map((p) => [p.seasonId, p.amount])),
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
      // Saving writes the master and nothing else. Which channels can be
      // brought up to date from this page is NOT the same as which ones hold
      // the product: Sitoo has no update path, so naming it beside a push
      // button that does not exist would be the one misleading sentence on the
      // screen.
      const pushable = targetedChannels.filter((c) => c !== "SITOO");
      const stuck = targetedChannels.filter((c) => c === "SITOO");
      const label = (c: string) => CHANNEL_LABELS[c as ChannelKey] ?? c;
      const parts = [
        pushable.length
          ? `${pushable.map(label).join(" and ")} still hold the old values — push below.`
          : "",
        stuck.length
          ? `${stuck.map(label).join(" and ")} cannot be updated from Origio yet and still show the old name and price.`
          : "",
      ].filter(Boolean);
      if (parts.length) toast.success(`Saved. ${parts.join(" ")}`);
      else toast.success("Saved.");
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
        className="text-fine text-muted-foreground underline underline-offset-4"
      >
        ← {header.styleName}
      </a>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-page">{header.name}</h1>
        <span className="font-mono text-body text-muted-foreground">
          {header.colorwaySku}
        </span>
        <a
          href={`/catalog/colorways/${colorwayId}/media`}
          className="text-body underline underline-offset-4"
        >
          Manage media →
        </a>
      </div>

      {/* Name and price — what the customer reads and pays. First on the page
          because it is the edit this screen is most often opened for, and
          because the composed-title preview has to be seen before anything
          below it is touched. */}
      <section className="mt-8 space-y-4 border p-5">
        <h2 className="text-body">Name and price</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Product name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Style</Label>
            <Input
              value={ownsStyle ? styleName : header.styleName}
              onChange={(e) => setStyleName(e.target.value)}
              disabled={!ownsStyle}
            />
            {/* Not the "Style name" field under Content: that one writes the
                Shopify `style_name` metafield and does not change the title. */}
            {ownsStyle && (
              <p className="text-fine text-muted-foreground">
                The parent style. The <span>Style name</span> field under Content
                is a Shopify metafield and does not change the title.
              </p>
            )}
            {!ownsStyle && (
              <p className="text-fine text-muted-foreground">
                Shared with {styleColorwayCount - 1} other colourway
                {styleColorwayCount - 1 === 1 ? "" : "s"} — rename it on{" "}
                <a
                  href={`/catalog/styles/${header.styleId}`}
                  className="underline underline-offset-4"
                >
                  the style page
                </a>
                .
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Title on Shopify and the till</Label>
          <p className="border bg-muted/40 px-3 py-2 font-mono text-body">
            {composedTitle || "—"}
          </p>
          <p className="text-fine text-muted-foreground">
            Composed from the style and the product name. Loom is sent the
            product name on its own — it nests style → colour → size, so the
            style is already one level up.
          </p>
        </div>

        {prices.length > 0 ? (
          <div className="space-y-1.5">
            <Label>NOK price (MSRP, incl. VAT)</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              {prices.map((p, i) => (
                <div key={p.seasonId} className="space-y-1">
                  <Input
                    value={p.amount}
                    inputMode="decimal"
                    onChange={(e) =>
                      setPrices((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, amount: e.target.value } : x
                        )
                      )
                    }
                  />
                  <span className="text-fine text-muted-foreground">{p.code}</span>
                </div>
              ))}
            </div>
            <p className="text-fine text-muted-foreground">
              Prices are per season. Clearing a field removes that season&rsquo;s
              price, which blocks the push rather than selling at zero.
            </p>
          </div>
        ) : (
          <p className="text-fine text-muted-foreground">
            This product is in no season, so it has nowhere to hold a price.
          </p>
        )}
      </section>

      {/* Product properties (always base) */}
      <section className="mt-6 space-y-4 border p-5">
        <h2 className="text-body">Product properties</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatusValue)}
              className="h-9 w-full border bg-transparent px-3 text-body"
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
      <section className="mt-6 border p-5">
        <h2 className="text-body">Content</h2>
        <p className="mt-1 text-fine text-muted-foreground">
          Tags and descriptions can differ per channel. Edit the shared{" "}
          <span>Base</span>, then override for Shopify
          (B2C) or Loom (B2B). Empty channel fields inherit the base value.
        </p>

        {/* Layer tabs */}
        <div className="mt-4 flex gap-1.5">
          {layers.map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              className={cn(
                "rounded-full border px-3 py-1 text-fine transition-colors",
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
                      <span className="ml-1.5 text-fine text-muted-foreground">
                        comma-separated
                      </span>
                    )}
                  </Label>
                  {!isBase && (
                    <span
                      className={cn(
                        "text-fine uppercase tracking-wide",
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
