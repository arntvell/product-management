import * as React from "react";

import { cn } from "@/lib/utils";

// §5: eyebrow, then title, then actions. The children slot is for Tabs, which
// sit flush to the bottom edge. One primary action per view, top right.
export interface PageHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-5 px-8 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {eyebrow && (
            <div className="text-meta uppercase text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="truncate font-display text-page uppercase">
              {title}
            </h1>
            {meta}
          </div>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

/** The page body: a stack of panels, gap-6, page gutter px-8. §5 */
export function Page({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page"
      className={cn("flex flex-col gap-6 px-8 pb-16 pt-6", className)}
      {...props}
    />
  );
}
