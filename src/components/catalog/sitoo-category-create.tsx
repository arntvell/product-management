"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

/**
 * Create a category in Sitoo's navigation without opening Sitoo's admin.
 *
 * Sitoo is read first: the same name under the same parent is linked rather
 * than created twice, and a near miss is shown before anything is written. A
 * create writes to the live till.
 */
export function SitooCategoryCreate({
  initialName,
  sitooCategories,
  categoryId,
  onDone,
  onCancel,
}: {
  initialName: string;
  /** Sitoo's navigation as pulled — the parent choices. */
  sitooCategories: { id: string; label: string }[];
  /** An existing Origo category to point at the result, if any. */
  categoryId?: string;
  onDone: (c: { id: string; label: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [parent, setParent] = useState("");
  const [similar, setSimilar] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function run(confirmSimilar: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/categories/sitoo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, parentSitooId: parent || null, categoryId, confirmSimilar }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the Sitoo category");
      if (!json.ok) {
        setSimilar(json.similar);
        return;
      }
      toast.success(
        json.action === "created"
          ? `Created "${json.label}" in Sitoo (${json.id})`
          : `Sitoo already had "${json.label}" (${json.id}) — linked it`
      );
      onDone({ id: json.id, label: `${json.label} (${json.id})` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the Sitoo category");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSimilar([]);
          }}
          placeholder="Name in the till"
        />
        <select
          className="h-9 w-full border bg-transparent px-3 text-body"
          value={parent}
          onChange={(e) => {
            setParent(e.target.value);
            setSimilar([]);
          }}
        >
          <option value="">— top level —</option>
          {sitooCategories.map((c) => (
            <option key={c.id} value={c.id}>
              under {c.label}
            </option>
          ))}
        </select>
      </div>
      {similar.length ? (
        <Notice
          title="Sitoo has similar categories"
          action={
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(true)}>
              Create anyway
            </Button>
          }
        >
          {similar.map((s) => `${s.label} (${s.id})`).join(", ")}. If it is one of these, pick it
          from the list instead.
        </Notice>
      ) : null}
      <p className="text-fine text-muted-foreground">
        Creates the category in the live till, unless Sitoo already has this name under this
        parent — then that one is used.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => run(false)}
          disabled={busy || !name.trim() || similar.length > 0}
        >
          {busy ? "Working…" : "Create in Sitoo"}
        </Button>
      </div>
    </div>
  );
}
