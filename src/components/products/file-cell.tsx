"use client";

import { cn } from "@/lib/utils";

interface FileCellProps {
  value: string;
  isDirty: boolean;
  onClick: () => void;
}

export function FileCell({ value, isDirty, onClick }: FileCellProps) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 min-h-[32px] cursor-pointer text-sm flex items-center",
        isDirty && "bg-yellow-50"
      )}
      onClick={onClick}
    >
      {value ? (
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs truncate">Flat set</span>
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">No flat</span>
      )}
    </div>
  );
}
