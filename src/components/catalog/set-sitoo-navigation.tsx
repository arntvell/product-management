"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SitooCategoryCreate } from "./sitoo-category-create";

/**
 * Give an EXISTING category its Sitoo navigation, where the gap is found.
 *
 * Tom Wood's import stopped on "Jewelry has no Sitoo navigation id", and the only
 * thing on the screen was "create new" — which made a second Jewelry and was
 * refused as a duplicate. The category was right; it lacked one value.
 */
export function SetSitooNavigation({
  categoryId,
  categoryName,
  sitooCategories,
  onSet,
}: {
  categoryId: string;
  categoryName: string;
  sitooCategories: { id: string; label: string }[];
  onSet: (sitooId: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(sitooId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/catalog/categories/${categoryId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sitooCategoryId: sitooId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      toast.success(`${categoryName} now files under Sitoo ${sitooId}`);
      onSet(sitooId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (creating)
    return (
      <SitooCategoryCreate
        initialName={categoryName}
        sitooCategories={sitooCategories}
        categoryId={categoryId}
        onCancel={() => setCreating(false)}
        onDone={(c) => {
          setCreating(false);
          onSet(c.id);
        }}
      />
    );

  return (
    <div className="space-y-1">
      <select
        className="h-9 w-full border border-ink bg-transparent px-3 text-body"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value === "__create__") setCreating(true);
          else if (e.target.value) void choose(e.target.value);
        }}
      >
        <option value="">Set {categoryName}&apos;s Sitoo navigation…</option>
        {sitooCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
        <option value="__create__">+ Create in Sitoo…</option>
      </select>
      <p className="text-fine text-muted-foreground">
        Products for Sitoo cannot be created until {categoryName} has one. Set once, it applies to
        every product in the category.
      </p>
    </div>
  );
}
