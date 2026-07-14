"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePages } from "@/hooks/use-pages";
import { useCollections } from "@/hooks/use-collections";
import { useModels } from "@/hooks/use-models";
import type { ColorwayOption } from "@/lib/master/queries";

export interface ReferenceValues {
  carePageId: string | null;
  fitguidePageId: string | null;
  recommendedCollectionId: string | null;
  modelInfoId: string | null;
  sameProduct: string[];
  styleWith: string[];
  styleWithUnisexHerre: string[];
  styleWithUnisexDame: string[];
}

export function ReferencesPanel({
  colorwayId,
  colorwayOptions,
  initial,
}: {
  colorwayId: string;
  colorwayOptions: ColorwayOption[];
  initial: ReferenceValues;
}) {
  const { carePages, fitguidePages } = usePages();
  const { collections } = useCollections();
  const { models } = useModels();

  const [v, setV] = useState<ReferenceValues>(initial);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ReferenceValues>(key: K, value: ReferenceValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/colorways/${colorwayId}/references`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      toast.success("References saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl px-6">
      <section className="rounded-lg border p-5">
        <h2 className="text-sm font-semibold">References</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Care / fit guide / collection / model point at Shopify resources.
          Product links point at other master products (resolved to Shopify
          products on push).
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SingleRef label="Care page" value={v.carePageId}
            options={carePages.map((p) => ({ id: p.id, label: p.title }))}
            onChange={(id) => set("carePageId", id)} />
          <SingleRef label="Fit guide" value={v.fitguidePageId}
            options={fitguidePages.map((p) => ({ id: p.id, label: p.title }))}
            onChange={(id) => set("fitguidePageId", id)} />
          <SingleRef label="Recommended collection" value={v.recommendedCollectionId}
            options={collections.map((c) => ({ id: c.id, label: c.title }))}
            onChange={(id) => set("recommendedCollectionId", id)} />
          <SingleRef label="Fit model" value={v.modelInfoId}
            options={models.map((m) => ({ id: m.id, label: m.fields.name || m.handle }))}
            onChange={(id) => set("modelInfoId", id)} />
        </div>

        <div className="mt-5 space-y-4">
          <ProductMulti label="Same product (other colours)" options={colorwayOptions}
            selected={v.sameProduct} onChange={(ids) => set("sameProduct", ids)} />
          <ProductMulti label="Style with" options={colorwayOptions}
            selected={v.styleWith} onChange={(ids) => set("styleWith", ids)} />
          <ProductMulti label="Style with — unisex (Herre)" options={colorwayOptions}
            selected={v.styleWithUnisexHerre} onChange={(ids) => set("styleWithUnisexHerre", ids)} />
          <ProductMulti label="Style with — unisex (Dame)" options={colorwayOptions}
            selected={v.styleWithUnisexDame} onChange={(ids) => set("styleWithUnisexDame", ids)} />
        </div>

        <div className="mt-5">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save references"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function SingleRef({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { id: string; label: string }[];
  onChange: (id: string | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProductMulti({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: ColorwayOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const labelById = useMemo(
    () => new Map(options.map((o) => [o.id, o.label])),
    [options]
  );
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return options
      .filter((o) => o.label.toLowerCase().includes(query) && !selected.includes(o.id))
      .slice(0, 8);
  }, [q, options, selected]);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span key={id} className="flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
              {labelById.get(id) ?? id}
              <button
                onClick={() => onChange(selected.filter((x) => x !== id))}
                className="text-muted-foreground hover:text-destructive"
                title="Remove"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products to link…"
          className="h-8"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-md">
            {matches.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onChange([...selected, o.id]);
                  setQ("");
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
