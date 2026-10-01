"use client";

import * as React from "react";

// §5: the breadcrumb is one of the two things that can fill the PageHeader
// eyebrow, the other being plain context like "SS26 · WEEK 40".
export function Breadcrumb({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void }>;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 text-meta uppercase text-muted-foreground"
    >
      {items.map((it, i) => (
        <React.Fragment key={`${it.label}-${i}`}>
          {i > 0 && <span aria-hidden="true">/</span>}
          {it.onClick ? (
            <button
              type="button"
              onClick={it.onClick}
              className="uppercase hover:text-ink"
            >
              {it.label}
            </button>
          ) : (
            <span className="text-ink">{it.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
