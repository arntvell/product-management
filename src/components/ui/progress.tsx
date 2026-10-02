import * as React from "react";

import { cn } from "@/lib/utils";

/** A thin ink bar on a line track. §6 */
export function Progress({
  value,
  label = true,
  className,
}: {
  value: number;
  label?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-1 flex-1 bg-line"
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-ink transition-all duration-560 ease-origo"
          style={{ width: `${v}%` }}
        />
      </div>
      {label && (
        <span className="w-9 text-right text-meta tabular-nums">{v}%</span>
      )}
    </div>
  );
}

/** Completeness names what is missing rather than only scoring it — §2
 *  principle 5, show what blocks the push. */
export function Completeness({
  value,
  missing = [],
}: {
  value: number;
  missing?: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-page tabular-nums">{value}%</span>
        <span className="text-meta uppercase text-muted-foreground">
          {missing.length ? `${missing.length} missing` : "Complete"}
        </span>
      </div>
      <Progress value={value} label={false} />
      {missing.length > 0 && (
        <ul className="flex flex-col">
          {missing.map((m) => (
            <li
              key={m}
              className="flex items-center gap-2 border-b border-line py-2 text-body last:border-b-0"
            >
              <span className="size-2 border border-ink" />
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
