import * as React from "react";

import { cn } from "@/lib/utils";

// §7: every number on an overview links to the list it describes. A Stat with
// onClick is a button; without one it is a figure.
export interface StatProps {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  onClick?: () => void;
}

export function Stat({ label, value, note, onClick }: StatProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex flex-col gap-3 bg-paper p-5 text-left",
        onClick && "transition-colors duration-150 ease-origo hover:bg-hover"
      )}
    >
      <span className="text-meta uppercase text-muted-foreground">{label}</span>
      <span className="font-display text-page tabular-nums">{value}</span>
      {note && <span className="text-body text-muted-foreground">{note}</span>}
    </Tag>
  );
}

/** A row of stats divided by hairlines — the gap-px on a line ground is what
 *  draws the dividers, so it needs no borders of its own. */
export function StatGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-group"
      className={cn(
        "grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4",
        className
      )}
      {...props}
    />
  );
}

/** Read-only properties in a side panel. §6 */
export function KeyValue({
  items,
  className,
}: {
  items: Array<[string, React.ReactNode]>;
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col", className)}>
      {items.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0"
        >
          <dt className="text-meta uppercase text-muted-foreground">{k}</dt>
          <dd className="text-right text-body tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
