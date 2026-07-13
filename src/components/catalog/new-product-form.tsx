"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CHANNELS, CHANNEL_LABELS, type ChannelKey } from "@/lib/master/fields";

interface Option {
  id: string;
  name: string;
}

export function NewProductForm({
  brands,
  manufacturers,
}: {
  brands: (Option & { isLivid: boolean })[];
  manufacturers: Option[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [channels, setChannels] = useState<Record<ChannelKey, boolean>>({
    SHOPIFY: true,
    LOOM: false,
  });
  const loomSelected = channels.LOOM;

  const [brandMode, setBrandMode] = useState<"existing" | "new">(
    brands.length ? "existing" : "new"
  );
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [brandNewName, setBrandNewName] = useState("");

  const [style, setStyle] = useState({
    styleName: "",
    styleSku: "",
    gender: "",
    unisex: false,
    category: "",
  });
  const [colorway, setColorway] = useState({
    name: "",
    colorwaySku: "",
    color: "",
    swatchHex: "",
    countryOfOrigin: "",
  });
  const [customs, setCustoms] = useState({
    hsCode: "",
    customsDescription: "",
    weightKg: "",
    fiberComposition: "",
  });
  const [manuMode, setManuMode] = useState<"existing" | "new">(
    manufacturers.length ? "existing" : "new"
  );
  const [manuId, setManuId] = useState(manufacturers[0]?.id ?? "");
  const [manuNewName, setManuNewName] = useState("");
  const [manuCountry, setManuCountry] = useState("");
  const [sizes, setSizes] = useState("");

  async function submit() {
    setSaving(true);
    try {
      const payload = {
        channels: CHANNELS.filter((c) => channels[c]),
        brand:
          brandMode === "existing"
            ? { existingId: brandId }
            : { newName: brandNewName },
        style: {
          styleName: style.styleName,
          styleSku: style.styleSku,
          gender: style.gender || null,
          unisex: style.unisex,
          category: style.category,
        },
        colorway: {
          name: colorway.name,
          colorwaySku: colorway.colorwaySku,
          color: colorway.color || null,
          swatchHex: colorway.swatchHex || null,
          countryOfOrigin: colorway.countryOfOrigin || null,
        },
        customs: {
          hsCode: customs.hsCode || null,
          customsDescription: customs.customsDescription || null,
          weightKg: customs.weightKg || null,
          fiberComposition: customs.fiberComposition || null,
        },
        manufacturer:
          manuMode === "existing"
            ? { existingId: manuId || undefined }
            : { newName: manuNewName || undefined, country: manuCountry || null },
        sizes: sizes.split(",").map((s) => s.trim()).filter(Boolean),
      };

      const res = await fetch("/api/catalog/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      toast.success("Product created");
      router.push(`/catalog/colorways/${data.colorwayId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <a
        href="/catalog"
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        ← Catalog
      </a>
      <h1 className="mt-1 text-2xl font-semibold">New external product</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a product from an external brand. Livid products come from
        Threadflow — use this for third-party brands and carry-over goods.
      </p>

      {/* Channels */}
      <Section title="Channels" hint="Where should this product publish?">
        <div className="flex gap-4">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels[c]}
                onChange={(e) =>
                  setChannels((p) => ({ ...p, [c]: e.target.checked }))
                }
              />
              {CHANNEL_LABELS[c]}
            </label>
          ))}
        </div>
        {loomSelected && (
          <p className="mt-2 text-xs text-muted-foreground">
            Loom requires the full customs block, manufacturer, and gender
            (below).
          </p>
        )}
      </Section>

      {/* Brand */}
      <Section title="Brand">
        <div className="flex flex-wrap items-center gap-2">
          {brands.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                checked={brandMode === "existing"}
                onChange={() => setBrandMode("existing")}
              />
              Existing
            </label>
          )}
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              checked={brandMode === "new"}
              onChange={() => setBrandMode("new")}
            />
            New
          </label>
        </div>
        {brandMode === "existing" ? (
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="mt-2 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isLivid ? " (Livid)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <Input
            className="mt-2"
            placeholder="Brand name"
            value={brandNewName}
            onChange={(e) => setBrandNewName(e.target.value)}
          />
        )}
      </Section>

      {/* Style */}
      <Section title="Style">
        <Grid>
          <Field label="Style name *">
            <Input
              value={style.styleName}
              onChange={(e) => setStyle((s) => ({ ...s, styleName: e.target.value }))}
            />
          </Field>
          <Field label="Style SKU *">
            <Input
              value={style.styleSku}
              onChange={(e) => setStyle((s) => ({ ...s, styleSku: e.target.value }))}
            />
          </Field>
          <Field label="Category *">
            <Input
              placeholder="Shirt, Jeans, …"
              value={style.category}
              onChange={(e) => setStyle((s) => ({ ...s, category: e.target.value }))}
            />
          </Field>
          <Field label={`Gender ${loomSelected ? "*" : ""}`}>
            <select
              value={style.gender}
              onChange={(e) => setStyle((s) => ({ ...s, gender: e.target.value }))}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="">—</option>
              <option value="women">Women</option>
              <option value="men">Men</option>
            </select>
          </Field>
        </Grid>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={style.unisex}
            onChange={(e) => setStyle((s) => ({ ...s, unisex: e.target.checked }))}
          />
          Unisex
        </label>
      </Section>

      {/* Colorway */}
      <Section title="Colorway">
        <Grid>
          <Field label="Colorway name *">
            <Input
              value={colorway.name}
              onChange={(e) => setColorway((c) => ({ ...c, name: e.target.value }))}
            />
          </Field>
          <Field label="Colorway SKU *">
            <Input
              value={colorway.colorwaySku}
              onChange={(e) =>
                setColorway((c) => ({ ...c, colorwaySku: e.target.value }))
              }
            />
          </Field>
          <Field label="Colour label">
            <Input
              value={colorway.color}
              onChange={(e) => setColorway((c) => ({ ...c, color: e.target.value }))}
            />
          </Field>
          <Field label="Swatch hex">
            <Input
              placeholder="#000000"
              value={colorway.swatchHex}
              onChange={(e) =>
                setColorway((c) => ({ ...c, swatchHex: e.target.value }))
              }
            />
          </Field>
          <Field label={`Country of origin ${loomSelected ? "*" : ""}`}>
            <Input
              value={colorway.countryOfOrigin}
              onChange={(e) =>
                setColorway((c) => ({ ...c, countryOfOrigin: e.target.value }))
              }
            />
          </Field>
        </Grid>
      </Section>

      {/* Customs (required for Loom) */}
      <Section
        title="Customs & manufacturer"
        hint={loomSelected ? "Required for Loom." : "Optional unless publishing to Loom."}
      >
        <Grid>
          <Field label={`HS code ${loomSelected ? "*" : ""}`}>
            <Input
              value={customs.hsCode}
              onChange={(e) => setCustoms((c) => ({ ...c, hsCode: e.target.value }))}
            />
          </Field>
          <Field label={`Weight (kg) ${loomSelected ? "*" : ""}`}>
            <Input
              placeholder="0.320"
              value={customs.weightKg}
              onChange={(e) => setCustoms((c) => ({ ...c, weightKg: e.target.value }))}
            />
          </Field>
          <Field label={`Fibre composition ${loomSelected ? "*" : ""}`}>
            <Input
              placeholder="100% Cotton"
              value={customs.fiberComposition}
              onChange={(e) =>
                setCustoms((c) => ({ ...c, fiberComposition: e.target.value }))
              }
            />
          </Field>
        </Grid>
        <Field label={`Customs description ${loomSelected ? "*" : ""}`} className="mt-3">
          <Textarea
            rows={2}
            value={customs.customsDescription}
            onChange={(e) =>
              setCustoms((c) => ({ ...c, customsDescription: e.target.value }))
            }
          />
        </Field>

        <div className="mt-4">
          <Label>Manufacturer {loomSelected ? "*" : ""}</Label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {manufacturers.length > 0 && (
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={manuMode === "existing"}
                  onChange={() => setManuMode("existing")}
                />
                Existing
              </label>
            )}
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                checked={manuMode === "new"}
                onChange={() => setManuMode("new")}
              />
              New
            </label>
          </div>
          {manuMode === "existing" ? (
            <select
              value={manuId}
              onChange={(e) => setManuId(e.target.value)}
              className="mt-2 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="">—</option>
              {manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="Manufacturer name"
                value={manuNewName}
                onChange={(e) => setManuNewName(e.target.value)}
              />
              <Input
                placeholder="Country"
                value={manuCountry}
                onChange={(e) => setManuCountry(e.target.value)}
              />
            </div>
          )}
        </div>
      </Section>

      {/* Variants */}
      <Section title="Sizes" hint="Comma-separated — one variant per size. SKUs are derived as COLORWAYSKU-SIZE.">
        <Input
          placeholder="XS, S, M, L, XL"
          value={sizes}
          onChange={(e) => setSizes(e.target.value)}
        />
      </Section>

      <div className="mt-6">
        <Button onClick={submit} disabled={saving}>
          {saving ? "Creating…" : "Create product"}
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
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
