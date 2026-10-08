"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOOM_CATEGORIES } from "@/lib/master/loom-category";
import { SitooCategoryCreate } from "./sitoo-category-create";

export interface NewCategoryOptions {
  /** Every category, for the parent picker. */
  parents: { id: string; name: string; depth: number }[];
  /** Shopify product types already in use — suggested, not enforced. */
  shopifyProductTypes: string[];
  /** Sitoo's navigation, as pulled: id and its path. */
  sitooCategories: { id: string; label: string }[];
}

export interface CreatedCategory {
  id: string;
  name: string;
  path: string;
  depth: number;
  sitooCategoryId: string | null;
}

/**
 * Create a category without leaving the import.
 *
 * The outbound values are asked for here, not left for /catalog/categories: a
 * category is what the push turns into Shopify's product type, Loom's category
 * and Sitoo's navigation, and one created with none of them made the Sitoo push
 * refuse every product filed under it. Each stays optional — a blank Shopify
 * type falls back to the product's own, and Sitoo can be set later — but the
 * form says what a blank costs.
 */
export function NewCategoryForm({
  options,
  initialName = "",
  onCreated,
  onCancel,
}: {
  options: NewCategoryOptions;
  initialName?: string;
  onCreated: (c: CreatedCategory) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [parentId, setParentId] = useState("");
  const [shopifyProductType, setShopifyProductType] = useState(initialName);
  const [loomCategory, setLoomCategory] = useState("");
  const [sitooCategoryId, setSitooCategoryId] = useState("");
  // Sitoo categories created from here join the list without a reload.
  const [sitooExtra, setSitooExtra] = useState<{ id: string; label: string }[]>([]);
  const [creatingInSitoo, setCreatingInSitoo] = useState(false);
  const sitooOptions = [...options.sitooCategories, ...sitooExtra];
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          parentId: parentId || null,
          shopifyProductType: shopifyProductType || null,
          loomCategory: loomCategory || null,
          sitooCategoryId: sitooCategoryId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the category");
      const parent = options.parents.find((p) => p.id === parentId);
      toast.success(`Created category ${name.trim()}`);
      onCreated({
        id: json.id,
        name: name.trim(),
        path: name.trim(),
        depth: parent ? parent.depth + 1 : 0,
        sitooCategoryId: sitooCategoryId || null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the category");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="nc-name" className="text-fine">
            Name
          </Label>
          <Input
            id="nc-name"
            className="mt-1.5"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Reed diffusers"
          />
        </div>
        <div>
          <Label htmlFor="nc-parent" className="text-fine">
            Parent (optional)
          </Label>
          <select
            id="nc-parent"
            className="mt-1.5 h-9 w-full border bg-transparent px-3 text-body"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— top level —</option>
            {options.parents.map((p) => (
              <option key={p.id} value={p.id}>
                {" ".repeat(p.depth * 2)}
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="nc-shopify" className="text-fine">
            Shopify product type
          </Label>
          <Input
            id="nc-shopify"
            className="mt-1.5"
            value={shopifyProductType}
            list="nc-shopify-types"
            onChange={(e) => setShopifyProductType(e.target.value)}
            placeholder="As the webshop filters on it"
          />
          <datalist id="nc-shopify-types">
            {options.shopifyProductTypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p className="mt-1 text-fine text-muted-foreground">
            Pick an existing type to keep the shop&apos;s filters together, or type a new one.
          </p>
        </div>
        <div>
          <Label htmlFor="nc-loom" className="text-fine">
            Loom category
          </Label>
          <select
            id="nc-loom"
            className="mt-1.5 h-9 w-full border bg-transparent px-3 text-body"
            value={loomCategory}
            onChange={(e) => setLoomCategory(e.target.value)}
          >
            <option value="">— none (sent as Uncategorized) —</option>
            {LOOM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="nc-sitoo" className="text-fine">
            Sitoo navigation
          </Label>
          {creatingInSitoo ? (
            <div className="mt-1.5">
              <SitooCategoryCreate
                initialName={name}
                sitooCategories={options.sitooCategories}
                onCancel={() => setCreatingInSitoo(false)}
                onDone={(c) => {
                  setSitooExtra((x) => (x.some((y) => y.id === c.id) ? x : [...x, c]));
                  setSitooCategoryId(c.id);
                  setCreatingInSitoo(false);
                }}
              />
            </div>
          ) : (
            <select
              id="nc-sitoo"
              className="mt-1.5 h-9 w-full border bg-transparent px-3 text-body"
              value={sitooCategoryId}
              onChange={(e) => {
                if (e.target.value === "__create__") {
                  setCreatingInSitoo(true);
                  return;
                }
                setSitooCategoryId(e.target.value);
              }}
            >
              <option value="">— none: products here cannot be created in Sitoo yet —</option>
              {sitooOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
              <option value="__create__">+ Create in Sitoo…</option>
            </select>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create category"}
        </Button>
      </div>
    </div>
  );
}
