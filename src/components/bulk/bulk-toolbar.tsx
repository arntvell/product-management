"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ColumnDef } from "@/lib/columns";
import type { MetafieldKey } from "@/types";

interface BulkToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkApply: () => void;
  onCopyDown: (fields: MetafieldKey[]) => void;
  onAddTag: (tag: string) => void;
  allTags?: string[];
  columns: ColumnDef[];
}

export function BulkToolbar({
  selectedCount,
  onClearSelection,
  onBulkApply,
  onCopyDown,
  onAddTag,
  allTags = [],
  columns,
}: BulkToolbarProps) {
  const [copyDownOpen, setCopyDownOpen] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<MetafieldKey>>(
    new Set()
  );
  const [addTagOpen, setAddTagOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");

  if (selectedCount === 0) return null;

  const tagSuggestions = tagInput.trim()
    ? allTags
        .filter((t) => t.toLowerCase().includes(tagInput.toLowerCase()))
        .slice(0, 8)
    : [];

  const applyTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    onAddTag(trimmed);
    setTagInput("");
    setAddTagOpen(false);
  };

  const toggleField = (key: MetafieldKey) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleApply = () => {
    onCopyDown([...selectedFields]);
    setSelectedFields(new Set());
    setCopyDownOpen(false);
  };

  const handleSelectAll = () => {
    setSelectedFields(new Set(columns.map((c) => c.key)));
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border-b">
      <span className="text-sm font-medium">
        {selectedCount} product{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <Button size="sm" variant="outline" onClick={onBulkApply}>
        Bulk Apply Value
      </Button>
      <Popover open={addTagOpen} onOpenChange={setAddTagOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            Add Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3 space-y-2">
          <div>
            <p className="text-sm font-medium">Add a tag</p>
            <p className="text-xs text-muted-foreground">
              Added to all {selectedCount} selected — existing tags are kept.
            </p>
          </div>
          <div className="flex gap-1">
            <Input
              autoFocus
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagInput.trim()) {
                  e.preventDefault();
                  applyTag(tagInput);
                }
              }}
              placeholder="Tag name..."
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              className="h-7"
              disabled={!tagInput.trim()}
              onClick={() => applyTag(tagInput)}
            >
              Add
            </Button>
          </div>
          {tagSuggestions.length > 0 && (
            <div className="border rounded text-xs divide-y max-h-32 overflow-auto">
              {tagSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="w-full text-left px-2 py-1 hover:bg-muted"
                  onClick={() => applyTag(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Popover open={copyDownOpen} onOpenChange={setCopyDownOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            Copy Down
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <div className="px-3 py-2 border-b">
            <p className="text-sm font-medium">Copy which fields?</p>
            <p className="text-xs text-muted-foreground">
              From first selected product to the rest
            </p>
          </div>
          <div className="max-h-[200px] overflow-auto p-2 space-y-1">
            {columns.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-1 py-1 text-sm hover:bg-muted/50 rounded cursor-pointer"
              >
                <Checkbox
                  checked={selectedFields.has(col.key)}
                  onCheckedChange={() => toggleField(col.key)}
                />
                {col.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 border-t">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={handleSelectAll}
            >
              Select All
            </Button>
            <Button
              size="sm"
              className="ml-auto"
              onClick={handleApply}
              disabled={selectedFields.size === 0}
            >
              Copy ({selectedFields.size})
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClearSelection}
        className="ml-auto"
      >
        Clear Selection
      </Button>
    </div>
  );
}
