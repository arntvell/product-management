import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// §6: neutral is an ink outline on paper, critical an inverted ink block.
// There are no coloured alerts in this system. §9 asks that a Notice carry the
// action that resolves it whenever one exists.
export interface NoticeProps {
  tone?: "neutral" | "critical";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function Notice({
  tone = "neutral",
  title,
  children,
  action,
  className,
}: NoticeProps) {
  const critical = tone === "critical";
  return (
    <div
      role={critical ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-start gap-3 px-4 py-3",
        critical
          ? "bg-ink text-offwhite"
          : "border border-ink bg-paper text-ink",
        className
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-meta uppercase">{title}</span>
        {children && (
          <span
            className={cn(
              "text-body",
              critical ? "text-offwhite" : "text-muted-foreground"
            )}
          >
            {children}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}
