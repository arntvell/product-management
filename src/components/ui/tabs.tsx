"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";

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
      className={cn(tabListClass, className)}
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
            className={tabItemClass(on)}
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
