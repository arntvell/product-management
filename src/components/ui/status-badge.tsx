import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// §2 principle 3: status is shape and word, never colour. The glyph carries
// the state at a glance; the label says it outright. Error is the only
// inverted one — it has to be the loudest thing on the screen.
export type ProductStatus =
  | "live"
  | "draft"
  | "pending"
  | "syncing"
  | "error"
  | "archived";

export const statusLabels: Record<ProductStatus, string> = {
  live: "Live",
  draft: "Draft",
  pending: "In review",
  syncing: "Syncing",
  error: "Error",
  archived: "Archived",
};

function StatusGlyph({ status }: { status: ProductStatus }) {
  const common = {
    width: 10,
    height: 10,
    viewBox: "0 0 10 10",
    "aria-hidden": true as const,
  };
  switch (status) {
    case "live":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4.5" fill="currentColor" />
        </svg>
      );
    case "draft":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" />
        </svg>
      );
    case "pending":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" />
          <path d="M5 1a4 4 0 0 1 0 8z" fill="currentColor" />
        </svg>
      );
    case "syncing":
      return (
        <svg {...common} className="animate-spin">
          <path
            d="M5 1a4 4 0 1 1-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "archived":
      return (
        <svg {...common}>
          <path d="M1 5h8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    default:
      return null;
  }
}

export interface StatusBadgeProps {
  status: ProductStatus;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const text = label ?? statusLabels[status];

  if (status === "error") {
    return (
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1.5 whitespace-nowrap bg-ink px-2 text-meta uppercase text-offwhite",
          className
        )}
      >
        <TriangleAlertIcon className="size-3" />
        {text}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-2 whitespace-nowrap text-meta uppercase",
        status === "archived" ? "text-muted-foreground" : "text-ink",
        className
      )}
    >
      <StatusGlyph status={status} />
      {text}
    </span>
  );
}
