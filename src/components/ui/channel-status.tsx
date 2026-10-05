import * as React from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusBadge, type ProductStatus } from "@/components/ui/status-badge";

// §6: one sales channel, one row — used on the overview, on a product detail
// and on the channels screen, so it reads the same wherever a channel appears.
export interface ChannelStatusProps {
  name: string;
  kind: string;
  status: ProductStatus;
  lastSync: string;
  products: number;
  issues?: number;
  onClick?: () => void;
  className?: string;
}

export function ChannelStatus({
  name,
  kind,
  status,
  lastSync,
  products,
  issues = 0,
  onClick,
  className,
}: ChannelStatusProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-line py-3 last:border-b-0",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-body text-ink">{name}</div>
        <div className="text-meta uppercase text-muted-foreground">
          {kind} · {lastSync}
        </div>
      </div>
      <div className="text-right text-body tabular-nums">
        {products.toLocaleString("nb-NO")}
      </div>
      <StatusBadge
        status={status}
        label={status === "error" ? `${issues} issues` : undefined}
        className="w-28 justify-end"
      />
      {onClick && (
        <button
          type="button"
          aria-label={`Open ${name}`}
          title={`Open ${name}`}
          onClick={onClick}
          className="inline-flex size-8 items-center justify-center text-ink transition-colors duration-150 hover:bg-hover"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
