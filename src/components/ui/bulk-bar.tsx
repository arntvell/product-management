"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// §6: an inverted ink bar above a table while rows are selected. Buttons
// inside it use variant="inverse".
export function BulkBar({
  count,
  onClear,
  children,
  className,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 bg-ink px-4 py-2 text-offwhite",
        className
      )}
    >
      <span className="text-meta uppercase tabular-nums">
        {count} selected
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        className="text-meta uppercase hover:opacity-70"
      >
        Clear
      </button>
    </div>
  );
}
