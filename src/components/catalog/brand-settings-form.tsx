"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PUBLISH_CHANNELS, PUBLISH_CHANNEL_LABELS } from "@/lib/master/fields";
import type { BrandSettings } from "@/lib/master/brands";

type Template = BrandSettings["template"];

export function BrandSettingsForm({
  initial,
  manufacturers,
  sizeSystems,
}: {
  initial: BrandSettings;
  manufacturers: { id: string; name: string }[];
  sizeSystems: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [skuToken, setSkuToken] = useState(initial.skuToken ?? "");
  const [t, setT] = useState<Template>(initial.template);
  const [example, setExample] = useState(initial.exampleStyleSku);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Template>(k: K, v: Template[K]) =>
    setT((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/catalog/brands/${initial.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skuToken: skuToken || null, template: t }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      if (json.settings?.exampleStyleSku) setExample(json.settings.exampleStyleSku);
      toast.success("Saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const tokenDiffers =
    !initial.isLivid && skuToken.toUpperCase() !== (initial.derivedToken ?? "");

  return (
    <div className="space-y-8">
      {!initial.isLivid ? (
        <Section
          title="SKU token"
          hint="What this brand is called in a SKU, between the EXT- prefix and the style."
        >
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div>
              <Label htmlFor="token" className="text-xs">
                Token
              </Label>
              <Input
                id="token"
                className="mt-1.5 font-mono"
                value={skuToken}
                maxLength={8}
                onChange={(e) => setSkuToken(e.target.value.toUpperCase())}
                placeholder={initial.derivedToken ?? ""}
              />
            </div>
            <div className="text-xs text-muted-foreground sm:pt-6">
              <div>
                A new style would be{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">{example}</code>
              </div>
              {tokenDiffers ? (
                <div className="mt-1">
                  The abbreviation rule alone would give{" "}
                  <code className="font-mono">{initial.derivedToken}</code>. Keeping the
                  token is usually right — 40 of 51 brands write something the rule would
                  not produce, and existing SKUs are never rewritten.
                </div>
              ) : null}
              {!skuToken ? (
                <div className="mt-1 text-amber-700 dark:text-amber-400">
                  No token set, so the rule applies. Check that matches what this brand
                  already uses before creating anything.
                </div>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        title="Product defaults"
        hint="Prefilled on every new product for this brand."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" value={t.category} onChange={(v) => set("category", v)} />
          <Field label="Gender" value={t.gender} onChange={(v) => set("gender", v)} />
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={t.unisex}
                onChange={(e) => set("unisex", e.target.checked)}
              />
              Unisex
            </label>
          </div>
          <div>
            <Label htmlFor="sizes" className="text-xs">
              Default size system
            </Label>
            <select
              id="sizes"
              className="mt-1.5 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={t.defaultSizeSystemId}
              onChange={(e) => set("defaultSizeSystemId", e.target.value)}
            >
              <option value="">— none —</option>
              {sizeSystems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section
        title="Customs"
        hint="Sent to Loom and Shopify. Not sent to Sitoo, which has no field for it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="HS code" value={t.hsCode} onChange={(v) => set("hsCode", v)} />
          <Field
            label="Country of origin"
            value={t.countryOfOrigin}
            onChange={(v) => set("countryOfOrigin", v)}
            hint="A country name or ISO code. Unrecognised values are omitted from Shopify rather than guessed."
          />
          <Field
            label="Weight (kg)"
            value={t.weightKg}
            onChange={(v) => set("weightKg", v)}
            placeholder="0.450"
          />
          <Field
            label="Fibre composition"
            value={t.fiberComposition}
            onChange={(v) => set("fiberComposition", v)}
          />
          <div className="sm:col-span-2">
            <Label htmlFor="customs" className="text-xs">
              Customs description
            </Label>
            <Textarea
              id="customs"
              className="mt-1.5"
              rows={2}
              value={t.customsDescription}
              onChange={(e) => set("customsDescription", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="manu" className="text-xs">
              Manufacturer
            </Label>
            <select
              id="manu"
              className="mt-1.5 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={t.manufacturerId}
              onChange={(e) => set("manufacturerId", e.target.value)}
            >
              <option value="">— none —</option>
              {manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section title="Channels" hint="Preselected when creating a product for this brand.">
        <div className="flex flex-wrap gap-4">
          {PUBLISH_CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={t.channels.includes(c)}
                onChange={(e) =>
                  set(
                    "channels",
                    e.target.checked
                      ? [...t.channels, c]
                      : t.channels.filter((x) => x !== c)
                  )
                }
              />
              {PUBLISH_CHANNEL_LABELS[c]}
            </label>
          ))}
        </div>
      </Section>

      <div className="flex justify-end">
        <Button disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = label.toLowerCase().replace(/\W+/g, "-");
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        className="mt-1.5"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
