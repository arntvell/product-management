import * as React from "react";

import { cn } from "@/lib/utils";

// §2: lines, not boxes. Panel is the only container in the system — paper on
// ecru inside a hairline, no shadow, no radius. Do not nest one in another.
// `flush` drops the body padding so a table can meet the frame.
// `title` is a node here, not the HTML tooltip attribute it shadows.
export interface PanelProps
  extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
}

export function Panel({
  title,
  description,
  actions,
  flush,
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <section
      data-slot="panel"
      className={cn("min-w-0 border border-line bg-paper", className)}
      {...props}
    >
      {(title || actions) && (
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-line px-5 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title && (
              <h2 className="font-display text-section uppercase">{title}</h2>
            )}
            {description && (
              <p className="text-body text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}
