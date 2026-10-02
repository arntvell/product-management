"use client";

import { cn } from "@/lib/utils";
import { dirtyCell } from "@/components/ui/grid";

interface FileCellProps {
  value: string;
  isDirty: boolean;
  onClick: () => void;
}

export function FileCell({ value, isDirty, onClick }: FileCellProps) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 min-h-[32px] cursor-pointer text-body flex items-center",
        isDirty && dirtyCell
      )}
      onClick={onClick}
    >
      {value ? (
        <div className="flex items-center gap-1">
          <span className="size-1.5 shrink-0 rounded-full bg-ink" />
          <span className="text-fine truncate">Flat set</span>
        </div>
      ) : (
        <span className="text-muted-foreground text-fine">No flat</span>
      )}
    </div>
  );
}
