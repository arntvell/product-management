"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CHANNELS, CHANNEL_LABELS, type ChannelKey } from "@/lib/master/fields";

interface SkuCheck {
  ok: boolean;
  normalized: string;
  errors: string[];
  warnings: string[];
}
interface Suggestion {
  proposed: string;
  derivedFrom: string;
}

/**
 * Shows the SKU the convention would give this product, and what is wrong with
 * the one that has been typed.
 *
 * Suggesting rather than forcing is deliberate. The catalogue has no single
 * convention to enforce — two schemes coexist, and measured over 115 style
 * names one matches 61% and the other 27% — so the honest move is to propose
 * the spelling the style already uses and let a person disagree.
 */
function SkuHint({
  row,
  check,
  suggestion,
  onUse,
}: {
  row: ProductRow;
  check: SkuCheck | null | undefined;
  suggestion: Suggestion | null | undefined;
  onUse: (sku: string) => void;
}) {
  const showSuggestion =
    suggestion && suggestion.proposed.toUpperCase() !== row.colorwaySku.trim().toUpperCase();
  if (!check?.errors.length && !check?.warnings.length && !showSuggestion) return null;

  return (
    <div className="col-span-2 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs sm:col-span-7">
      {check?.errors.map((e) => (
        <span key={e} className="text-destructive">
          {e}
        </span>
      ))}
      {check?.warnings.map((w) => (
        <span key={w} className="text-amber-600 dark:text-amber-400">
          {w}
        </span>
      ))}
      {showSuggestion ? (
        <button
          type="button"
          onClick={() => onUse(suggestion.proposed)}
          className="underline underline-offset-4 hover:no-underline"
          title={`From ${suggestion.derivedFrom}`}
        >
          use <code className="font-medium">{suggestion.proposed}</code>
        </button>
      ) : null}
      {showSuggestion ? (
        <span className="text-muted-foreground">from {suggestion.derivedFrom}</span>
      ) : null}
    </div>
  );
}

interface Brand {
  id: string;
  name: string;
  isLivid: boolean;
  hasTemplate: boolean;
}
interface Option {
  id: string;
  name: string;
}

interface Template {
  category: string;
  gender: string;
  unisex: boolean;
  channels: Record<ChannelKey, boolean>;
  hsCode: string;
  customsDescription: string;
  weightKg: string;
  fiberComposition: string;
  countryOfOrigin: string;
  manuMode: "existing" | "new";
  manuId: string;
  manuNewName: string;
  manuCountry: string;
  sizes: string;
}

interface ProductRow {
  name: string;
  colorwaySku: string;
  color: string;
  swatchHex: string;
  priceNok: string;
  sizes: string;
}

const emptyTemplate = (manuId: string): Template => ({
  category: "",
  gender: "",
  unisex: false,
  channels: { SHOPIFY: true, LOOM: false },
  hsCode: "",
  customsDescription: "",
  weightKg: "",
  fiberComposition: "",
  countryOfOrigin: "",
  manuMode: manuId ? "existing" : "new",
  manuId,
  manuNewName: "",
  manuCountry: "",
  sizes: "",
});

const emptyRow = (): ProductRow => ({
  name: "",
  colorwaySku: "",
  color: "",
  swatchHex: "",
  priceNok: "",
  sizes: "",
});

export function BrandProductBuilder({
  brands,
  manufacturers,
}: {
  brands: Brand[];
  manufacturers: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const [brandMode, setBrandMode] = useState<"existing" | "new">(
    brands.length ? "existing" : "new"
  );
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [brandNewName, setBrandNewName] = useState("");
  // A brand created here is external by definition; an existing one carries the
  // flag. Drives channel eligibility (see the channel checkboxes below).
  const brandIsLivid =
    brandMode === "existing" && !!brands.find((b) => b.id === brandId)?.isLivid;
  const [tpl, setTpl] = useState<Template>(emptyTemplate(manufacturers[0]?.id ?? ""));
  const [skuChecks, setSkuChecks] = useState<Record<number, SkuCheck | null>>({});
  const [skuSuggest, setSkuSuggest] = useState<Record<number, Suggestion | null>>({});
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [rows, setRows] = useState<ProductRow[]>([emptyRow(), emptyRow()]);

  const loomSelected = tpl.channels.LOOM;

  /** Validate a typed SKU against the master. */
  async function checkSku(i: number) {
    const sku = rows[i]?.colorwaySku.trim();
    if (!sku) {
      setSkuChecks((p) => ({ ...p, [i]: null }));
      return;
    }
    try {
      const res = await fetch("/api/catalog/skus/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      const data = await res.json();
      setSkuChecks((p) => ({ ...p, [i]: data.validation ?? null }));
    } catch {
      // A failed check must not block typing.
    }
  }

  /** Ask what the convention would call this product. */
  async function suggestSku(i: number) {
    const r = rows[i];
    if (!r?.name.trim()) return;
    try {
      const res = await fetch("/api/catalog/skus/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggest: {
            prefix: brandIsLivid ? "LIV" : "EXT",
            brand: brandIsLivid ? undefined : brandName(),
            style: r.name,
            color: r.color,
          },
        }),
      });
      const data = await res.json();
      if (data.proposed) {
        setSkuSuggest((p) => ({
          ...p,
          [i]: { proposed: data.proposed, derivedFrom: data.derivedFrom ?? "" },
        }));
      }
    } catch {
      // Suggestions are a convenience, never a blocker.
    }
  }

  function brandName(): string {
    return brandMode === "existing"
      ? (brands.find((b) => b.id === brandId)?.name ?? "")
      : brandNewName;
  }

  async function onBrandChange(id: string) {
    setBrandId(id);
    // Load saved template if present.
    try {
      const res = await fetch(`/api/catalog/brands/${id}/template`);
      const data = await res.json();
      if (data.template) {
        const t = data.template;
        setTpl({
          category: t.category,
          gender: t.gender,
          unisex: t.unisex,
          channels: {
            SHOPIFY: t.channels.includes("SHOPIFY"),
            LOOM: t.channels.includes("LOOM"),
          },
          hsCode: t.hsCode,
          customsDescription: t.customsDescription,
          weightKg: t.weightKg,
          fiberComposition: t.fiberComposition,
          countryOfOrigin: t.countryOfOrigin,
          manuMode: t.manufacturerId ? "existing" : "new",
          manuId: t.manufacturerId,
          manuNewName: "",
          manuCountry: "",
          sizes: t.sizes.join(", "),
        });
        toast.success("Loaded brand template");
      }
    } catch {
      /* no template — leave as-is */
    }
  }

  function setRow(i: number, patch: Partial<ProductRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        brand:
          brandMode === "existing"
            ? { existingId: brandId }
            : { newName: brandNewName },
        template: {
          category: tpl.category || null,
          gender: tpl.gender || null,
          unisex: tpl.unisex,
          channels: CHANNELS.filter((c) => tpl.channels[c]),
          hsCode: tpl.hsCode || null,
          customsDescription: tpl.customsDescription || null,
          weightKg: tpl.weightKg || null,
          fiberComposition: tpl.fiberComposition || null,
          countryOfOrigin: tpl.countryOfOrigin || null,
          manufacturer:
            tpl.manuMode === "existing"
              ? { existingId: tpl.manuId || undefined }
              : { newName: tpl.manuNewName || undefined, country: tpl.manuCountry || null },
          sizes: tpl.sizes.split(",").map((s) => s.trim()).filter(Boolean),
        },
        saveTemplate,
        products: rows
          .filter((r) => r.name.trim() || r.colorwaySku.trim())
          .map((r) => ({
            name: r.name,
            colorwaySku: r.colorwaySku,
            color: r.color || null,
            swatchHex: r.swatchHex || null,
            priceNok: r.priceNok || null,
            sizes: r.sizes.split(",").map((s) => s.trim()).filter(Boolean),
          })),
      };
      const res = await fetch("/api/catalog/products/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      toast.success(`Created ${data.created} products`);
      router.push("/catalog/styles?season=CONTINUITY");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <a href="/catalog" className="text-xs text-muted-foreground underline underline-offset-4">
        ← Catalog
      </a>
      <h1 className="mt-1 text-2xl font-semibold">New products</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create several products for a brand at once. The template holds the
        shared defaults (category, channels, customs, manufacturer, sizes) — save
        it so the next batch for this brand is pre-filled.
      </p>

      {/* Brand */}
      <Section title="Brand">
        <div className="flex flex-wrap items-center gap-3">
          {brands.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={brandMode === "existing"} onChange={() => setBrandMode("existing")} />
              Existing
            </label>
          )}
          <label className="flex items-center gap-1.5 text-sm">
            <input type="radio" checked={brandMode === "new"} onChange={() => setBrandMode("new")} />
            New brand
          </label>
        </div>
        {brandMode === "existing" ? (
          <select
            value={brandId}
            onChange={(e) => onBrandChange(e.target.value)}
            className="mt-2 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.hasTemplate ? " · has template" : ""}
                {b.isLivid ? " (Livid)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <Input
            className="mt-2"
            placeholder="New brand name"
            value={brandNewName}
            onChange={(e) => setBrandNewName(e.target.value)}
          />
        )}
      </Section>

      {/* Template */}
      <Section
        title="Template — shared across all products in this batch"
        hint={loomSelected ? "Loom requires the full customs block + manufacturer." : undefined}
      >
        <div className="mb-3 flex flex-wrap items-center gap-4">
          {CHANNELS.map((c) => {
            // Loom carries Livid's own production only — externals are resold
            // goods, not wholesale lines. Offering the checkbox here was one
            // click away from putting an external brand into the B2B feed.
            const allowed = c !== "LOOM" || brandIsLivid;
            if (!allowed) return null;
            return (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={tpl.channels[c]}
                  onChange={(e) => setTpl((t) => ({ ...t, channels: { ...t.channels, [c]: e.target.checked } }))}
                />
                {CHANNEL_LABELS[c]}
              </label>
            );
          })}
          {!brandIsLivid && (
            <span className="text-xs text-muted-foreground">
              Shopify only — Loom carries Livid production, not external brands.
            </span>
          )}
        </div>
        <Grid>
          <Field label="Category *">
            <Input placeholder="Footwear, Accessories, Scents…" value={tpl.category}
              onChange={(e) => setTpl((t) => ({ ...t, category: e.target.value }))} />
          </Field>
          <Field label={`Gender ${loomSelected ? "*" : ""}`}>
            <select value={tpl.gender} onChange={(e) => setTpl((t) => ({ ...t, gender: e.target.value }))}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">
              <option value="">—</option>
              <option value="women">Women</option>
              <option value="men">Men</option>
            </select>
          </Field>
          <Field label={`HS code ${loomSelected ? "*" : ""}`}>
            <Input value={tpl.hsCode} onChange={(e) => setTpl((t) => ({ ...t, hsCode: e.target.value }))} />
          </Field>
          <Field label={`Weight (kg) ${loomSelected ? "*" : ""}`}>
            <Input placeholder="0.320" value={tpl.weightKg}
              onChange={(e) => setTpl((t) => ({ ...t, weightKg: e.target.value }))} />
          </Field>
          <Field label={`Fibre / material ${loomSelected ? "*" : ""}`}>
            <Input value={tpl.fiberComposition}
              onChange={(e) => setTpl((t) => ({ ...t, fiberComposition: e.target.value }))} />
          </Field>
          <Field label={`Country of origin ${loomSelected ? "*" : ""}`}>
            <Input value={tpl.countryOfOrigin}
              onChange={(e) => setTpl((t) => ({ ...t, countryOfOrigin: e.target.value }))} />
          </Field>
        </Grid>
        <Field label={`Customs description ${loomSelected ? "*" : ""}`} className="mt-3">
          <Textarea rows={2} value={tpl.customsDescription}
            onChange={(e) => setTpl((t) => ({ ...t, customsDescription: e.target.value }))} />
        </Field>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Default sizes (comma-separated)">
            <Input placeholder="OS  or  39,40,41,42  or  S,M,L" value={tpl.sizes}
              onChange={(e) => setTpl((t) => ({ ...t, sizes: e.target.value }))} />
          </Field>
          <div>
            <Label>Manufacturer {loomSelected ? "*" : ""}</Label>
            <div className="mt-1 flex items-center gap-3">
              {manufacturers.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="radio" checked={tpl.manuMode === "existing"} onChange={() => setTpl((t) => ({ ...t, manuMode: "existing" }))} />
                  Existing
                </label>
              )}
              <label className="flex items-center gap-1.5 text-xs">
                <input type="radio" checked={tpl.manuMode === "new"} onChange={() => setTpl((t) => ({ ...t, manuMode: "new" }))} />
                New
              </label>
            </div>
            {tpl.manuMode === "existing" ? (
              <select value={tpl.manuId} onChange={(e) => setTpl((t) => ({ ...t, manuId: e.target.value }))}
                className="mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm">
                <option value="">—</option>
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Input placeholder="Name" value={tpl.manuNewName} onChange={(e) => setTpl((t) => ({ ...t, manuNewName: e.target.value }))} />
                <Input placeholder="Country" value={tpl.manuCountry} onChange={(e) => setTpl((t) => ({ ...t, manuCountry: e.target.value }))} />
              </div>
            )}
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={tpl.unisex} onChange={(e) => setTpl((t) => ({ ...t, unisex: e.target.checked }))} />
          Unisex
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
          Save these defaults as the brand&apos;s template
        </label>
      </Section>

      {/* Products */}
      <Section title="Products">
        <div className="space-y-2">
          <div className="hidden grid-cols-[1.4fr_1.2fr_0.8fr_0.7fr_0.7fr_1fr_auto] gap-2 px-1 text-[10px] uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Name</span><span>SKU</span><span>Colour</span><span>Hex</span><span>NOK</span><span>Sizes (opt.)</span><span></span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1.2fr_0.8fr_0.7fr_0.7fr_1fr_auto]">
              <Input placeholder="Name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} onBlur={() => suggestSku(i)} />
              <div className="relative">
                <Input
                  placeholder="SKU"
                  value={r.colorwaySku}
                  onChange={(e) => setRow(i, { colorwaySku: e.target.value })}
                  onBlur={() => checkSku(i)}
                  aria-invalid={skuChecks[i]?.errors?.length ? true : undefined}
                  className={skuChecks[i]?.errors?.length ? "border-destructive" : undefined}
                />
              </div>
              <Input placeholder="Colour" value={r.color} onChange={(e) => setRow(i, { color: e.target.value })} onBlur={() => suggestSku(i)} />
              <Input placeholder="#hex" value={r.swatchHex} onChange={(e) => setRow(i, { swatchHex: e.target.value })} />
              <Input placeholder="NOK" value={r.priceNok} onChange={(e) => setRow(i, { priceNok: e.target.value })} />
              <Input placeholder="(template)" value={r.sizes} onChange={(e) => setRow(i, { sizes: e.target.value })} />
              <button
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive"
                title="Remove row"
              >
                ✕
              </button>
              <SkuHint
                key={`hint-${i}`}
                row={r}
                check={skuChecks[i]}
                suggestion={skuSuggest[i]}
                onUse={(sku) => { setRow(i, { colorwaySku: sku }); setSkuChecks((p) => ({ ...p, [i]: null })); }}
              />
            </div>
          ))}
        </div>
        <button
          onClick={() => setRows((prev) => [...prev, emptyRow()])}
          className="mt-3 text-sm font-medium underline underline-offset-4"
        >
          + Add product
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          {brandIsLivid ? (
            <>
              Barcodes are allocated from the master&rsquo;s ledger on the{" "}
              <code className="rounded bg-muted px-1">7000000</code> internal
              series — the one the CFO&rsquo;s list already uses for product that
              is not a production run. Threadflow owns the{" "}
              <code className="rounded bg-muted px-1">7072536</code> counter, so
              nothing created here draws from it.
            </>
          ) : (
            <>
              External product keeps the brand&rsquo;s own EAN, so no barcode is
              allocated here. Add it in the editor once you have it from the
              supplier.
            </>
          )}
        </p>
      </Section>

      <div className="mt-6">
        <Button onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create products"}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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
function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
