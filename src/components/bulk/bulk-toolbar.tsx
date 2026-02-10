"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  columns: ColumnDef[];
}

export function BulkToolbar({
  selectedCount,
  onClearSelection,
  onBulkApply,
  onCopyDown,
  columns,
}: BulkToolbarProps) {
  const [copyDownOpen, setCopyDownOpen] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<MetafieldKey>>(
    new Set()
  );

  if (selectedCount === 0) return null;

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
