import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The filled dot already means "live" in StatusBadge. It means the same thing
 * in the chrome: what you do here reaches the live store now, with no push
 * step in between. Shape and word, never colour — §2.
 */
export function LiveDot({
  size = 6,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 6 6"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
  );
}
