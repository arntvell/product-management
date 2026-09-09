"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COPYABLE_FIELDS,
  stripTags,
  type CopySource,
  type CopyableField,
} from "@/lib/master/copy-fields";

/**
 * Take the merchandising fields off a product that has already been written.
 *
 * A new style is usually a variation on something written before — the APT
 * shirt reads much like Brass. Search for that product, pick the fields worth
 * taking, and they land as pending edits on the whole selection to review and
 * edit before saving. Nothing is written to Shopify here.
 */
export function CopyFieldsDialog({
  open,
  onOpenChange,
  targetCount,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many rows the copy would land on. */
  targetCount: number;
  onCopy: (
    values: Partial<Record<CopyableField, string>>,
    tagsMode: "replace" | "add"
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<CopySource[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<CopySource | null>(null);
  const [fields, setFields] = useState<Set<CopyableField>>(new Set());
  const [tagsMode, setTagsMode] = useState<"replace" | "add">("add");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSources(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/catalog/copy-source?q=${encodeURIComponent(q.trim())}`
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Search failed");
      setSources(d.sources ?? []);
      setWarnings(d.warnings ?? []);
    } catch {
      setSources([]);
      setWarnings(["Search failed."]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced so typing does not hammer the Shopify API.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(query), 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, search]);

  const pick = (s: CopySource) => {
    setPicked(s);
    // Default to the long-form copy — that is what nobody wants to retype —
    // and leave type/tags/references opt-in, since those are usually already
    // right on a new product and wrong to inherit wholesale.
    setFields(
      new Set(
        (["fullDescription", "shortDescription", "details", "styleTagline"] as CopyableField[]).filter(
          (f) => s.values[f]
        )
      )
    );
  };

  const toggle = (f: CopyableField) =>
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const apply = () => {
    if (!picked || !fields.size) return;
    if (
      targetCount >= 25 &&
      !confirm(`Copy ${fields.size} field(s) onto ${targetCount} products?`)
    )
      return;
    const values: Partial<Record<CopyableField, string>> = {};
    for (const f of fields) {
      const v = picked.values[f];
      if (v !== undefined) values[f] = v;
    }
    onCopy(values, tagsMode);
    onOpenChange(false);
  };

  const reset = () => {
    setPicked(null);
    setFields(new Set());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setSources(null);
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col">
        <DialogHeader>
          <DialogTitle>Copy fields from a product</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Find a product that is already written — Shopify included, which is
            where the older copy lives — and take the fields worth taking onto
            the {targetCount} selected {targetCount === 1 ? "product" : "products"}.
          </p>
        </DialogHeader>

        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            reset();
          }}
          placeholder="Search by product name, handle or SKU — e.g. Brass"
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />

        {warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700 dark:text-amber-500">
            {w}
          </p>
        ))}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {searching && (
            <p className="py-4 text-center text-xs text-muted-foreground">Searching…</p>
          )}

          {!searching && sources?.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nothing found with fields to copy. Products with no copy at all are
              not listed.
            </p>
          )}

          {/* Pick a source */}
          {!picked &&
            !searching &&
            sources?.map((s) => (
              <button
                key={`${s.origin}:${s.id}`}
                type="button"
                onClick={() => pick(s)}
                className="flex w-full items-start gap-2 border-b p-2 text-left last:border-0 hover:bg-muted/60"
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    s.origin === "shopify"
                      ? "bg-green-500/15 text-green-700 dark:text-green-500"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {s.origin}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {s.reference}
                    {s.vendor && <> · {s.vendor}</>} ·{" "}
                    {Object.keys(s.values).length} field(s) to copy
                  </span>
                </span>
              </button>
            ))}

          {/* Choose what to take from it */}
          {picked && (
            <div>
              <div className="flex items-center gap-2 border-b pb-2">
                <span className="text-sm font-medium">{picked.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {picked.origin} · {picked.reference}
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="ml-auto text-xs text-muted-foreground underline underline-offset-4"
                >
                  Pick another
                </button>
              </div>

              <ul className="mt-1">
                {COPYABLE_FIELDS.map(({ field, label }) => {
                  const value = picked.values[field];
                  if (!value) return null;
                  const preview = stripTags(value);
                  return (
                    <li key={field} className="border-b py-2 last:border-0">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={fields.has(field)}
                          onChange={() => toggle(field)}
                          className="mt-1"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-xs font-medium">{label}</span>
                          {value !== preview && (
                            <span
                              className="ml-1 text-[10px] uppercase text-muted-foreground"
                              title="The value is HTML; the preview has the tags removed. The markup itself is what gets copied, because Shopify renders it."
                            >
                              html
                            </span>
                          )}
                          <span className="mt-0.5 block whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                            {preview.slice(0, 300)}
                            {preview.length > 300 && "…"}
                          </span>
                        </span>
                      </label>
                      {field === "tags" && fields.has("tags") && (
                        <div className="ml-6 mt-1 flex gap-3 text-[11px]">
                          {(["add", "replace"] as const).map((m) => (
                            <label key={m} className="flex items-center gap-1">
                              <input
                                type="radio"
                                checked={tagsMode === m}
                                onChange={() => setTagsMode(m)}
                              />
                              {m === "add"
                                ? "add to existing tags"
                                : "replace existing tags"}
                            </label>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-2 sm:justify-start">
          <Button onClick={apply} disabled={!picked || !fields.size}>
            Copy {fields.size || ""} field{fields.size === 1 ? "" : "s"} to{" "}
            {targetCount} row{targetCount === 1 ? "" : "s"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Lands as pending edits — review, then <b>Save</b>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
