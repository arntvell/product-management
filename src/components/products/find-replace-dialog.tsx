"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TEXT_COLUMNS } from "@/lib/columns";
import type { MetafieldKey, Product, DirtyCell } from "@/types";

interface FindReplaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  dirtyCells: Map<string, DirtyCell>;
  onApply: (
    replacements: Array<{ productId: string; field: MetafieldKey; value: string }>
  ) => void;
}

interface Match {
  product: Product;
  field: MetafieldKey;
  fieldLabel: string;
  currentValue: string;
  newValue: string;
  occurrences: number;
  snippets: Array<{ before: string; match: string; after: string }>;
}

function extractSnippets(
  text: string,
  searchStr: string,
  contextLen = 50
): Array<{ before: string; match: string; after: string }> {
  const snippets: Array<{ before: string; match: string; after: string }> = [];
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(searchStr, pos);
    if (idx === -1) break;
    const start = Math.max(0, idx - contextLen);
    const end = Math.min(text.length, idx + searchStr.length + contextLen);
    snippets.push({
      before: (start > 0 ? "…" : "") + text.slice(start, idx),
      match: text.slice(idx, idx + searchStr.length),
      after: text.slice(idx + searchStr.length, end) + (end < text.length ? "…" : ""),
    });
    pos = idx + searchStr.length;
  }
  return snippets;
}

export function FindReplaceDialog({
  open,
  onOpenChange,
  products,
  dirtyCells,
  onApply,
}: FindReplaceDialogProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [selectedFields, setSelectedFields] = useState<Set<MetafieldKey>>(
    new Set(TEXT_COLUMNS.map((c) => c.key))
  );

  const getValue = (product: Product, field: MetafieldKey) => {
    const dirty = dirtyCells.get(`${product.id}:${field}`);
    return dirty ? dirty.value : product.metafields[field];
  };

  const matches = useMemo((): Match[] => {
    if (!findText.trim()) return [];
    const results: Match[] = [];

    for (const product of products) {
      for (const col of TEXT_COLUMNS) {
        if (!selectedFields.has(col.key)) continue;
        const value = getValue(product, col.key);
        if (!value || !value.includes(findText)) continue;

        const count = value.split(findText).length - 1;
        results.push({
          product,
          field: col.key,
          fieldLabel: col.label,
          currentValue: value,
          newValue: value.replaceAll(findText, replaceText),
          occurrences: count,
          snippets: extractSnippets(value, findText),
        });
      }
    }
    return results;
  }, [findText, replaceText, selectedFields, products, dirtyCells]);

  const totalOccurrences = useMemo(
    () => matches.reduce((n, m) => n + m.occurrences, 0),
    [matches]
  );

  const uniqueProducts = useMemo(
    () => new Set(matches.map((m) => m.product.id)).size,
    [matches]
  );

  const toggleField = (key: MetafieldKey) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApply = () => {
    onApply(
      matches.map((m) => ({
        productId: m.product.id,
        field: m.field,
        value: m.newValue,
      }))
    );
    setFindText("");
    setReplaceText("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Find & Replace</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Find</Label>
              <Input
                placeholder="Text to find..."
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Replace with</Label>
              <Input
                placeholder="Replacement (leave empty to delete)..."
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Search in fields</Label>
            <div className="flex gap-2 flex-wrap">
              {TEXT_COLUMNS.map((col) => (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => toggleField(col.key)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    selectedFields.has(col.key)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-foreground"
                  }`}
                >
                  {col.label}
                </button>
              ))}
            </div>
          </div>

          {findText && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {matches.length === 0 ? (
                  "No matches found."
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {totalOccurrences} occurrence
                      {totalOccurrences !== 1 ? "s" : ""}
                    </span>{" "}
                    across{" "}
                    <span className="font-medium text-foreground">
                      {uniqueProducts} product
                      {uniqueProducts !== 1 ? "s" : ""}
                    </span>
                    {replaceText !== findText && replaceText !== "" && (
                      <>
                        {" "}
                        — replacing{" "}
                        <code className="bg-red-50 text-red-700 px-1 rounded text-xs">
                          {findText}
                        </code>{" "}
                        with{" "}
                        <code className="bg-green-50 text-green-700 px-1 rounded text-xs">
                          {replaceText}
                        </code>
                      </>
                    )}
                  </>
                )}
              </p>

              {matches.length > 0 && (
                <div className="border rounded divide-y max-h-72 overflow-auto text-xs">
                  {matches.map((m, i) => (
                    <div key={i} className="px-3 py-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.product.title}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{m.fieldLabel}</span>
                        {m.occurrences > 1 && (
                          <span className="ml-auto text-muted-foreground shrink-0">
                            {m.occurrences}×
                          </span>
                        )}
                      </div>
                      {m.snippets.slice(0, 2).map((s, j) => (
                        <p
                          key={j}
                          className="font-mono text-[11px] text-muted-foreground leading-relaxed"
                        >
                          {s.before}
                          <mark className="bg-yellow-200 text-yellow-900 not-italic px-0">
                            {s.match}
                          </mark>
                          {s.after}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={matches.length === 0 || !findText.trim()}
          >
            Replace all ({totalOccurrences})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
