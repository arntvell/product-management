"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// §6: underline tabs with counts — status filters on lists, sections on a
// detail page, seasons on pricing. They sit flush at the bottom of PageHeader.
export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-6 overflow-x-auto border-b border-line", className)}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 text-meta uppercase transition-colors duration-150 ease-origo",
              on
                ? "border-ink text-ink"
                : "border-transparent text-muted-foreground hover:text-ink"
            )}
          >
            {t.label}
            {t.count != null && (
              <span className="tabular-nums">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
