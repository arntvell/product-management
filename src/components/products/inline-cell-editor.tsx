"use client";

import { cn, parseGidList } from "@/lib/utils";

interface InlineCellEditorProps {
  value: string;
  isDirty?: boolean;
  isProductRef?: boolean;
  onClick: () => void;
}

export function InlineCellEditor({
  value,
  isDirty,
  isProductRef,
  onClick,
}: InlineCellEditorProps) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 min-h-[32px] cursor-pointer text-sm truncate hover:bg-muted/40 transition-colors",
        isDirty && "bg-yellow-50",
        !value && !isProductRef && "text-muted-foreground"
      )}
      onClick={onClick}
      title={value || undefined}
    >
      {isProductRef ? (
        <span className="text-xs text-muted-foreground">
          {value ? `${parseGidList(value).length} linked` : "None"}
        </span>
      ) : (
        value || "—"
      )}
    </div>
  );
}
