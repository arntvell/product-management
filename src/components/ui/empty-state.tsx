import * as React from "react";

// §6 and §10: a section title, one factual sentence, one action. No
// illustration, no apology.
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className="font-display text-section uppercase">{title}</h3>
      {body && (
        <p className="max-w-md text-body text-muted-foreground">{body}</p>
      )}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
