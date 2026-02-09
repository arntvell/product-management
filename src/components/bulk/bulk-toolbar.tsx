"use client";

import { Button } from "@/components/ui/button";

interface BulkToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkApply: () => void;
  onCopyDown: () => void;
}

export function BulkToolbar({
  selectedCount,
  onClearSelection,
  onBulkApply,
  onCopyDown,
}: BulkToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border-b">
      <span className="text-sm font-medium">
        {selectedCount} product{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <Button size="sm" variant="outline" onClick={onBulkApply}>
        Bulk Apply Value
      </Button>
      <Button size="sm" variant="outline" onClick={onCopyDown}>
        Copy Down
      </Button>
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
