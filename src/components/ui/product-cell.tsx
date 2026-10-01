import * as React from "react";
import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** A 4:5 product thumbnail. Studio cut-outs sit on paper; a missing image
 *  shows an outline glyph on hover ground rather than an empty box. §6 */
export function Thumb({
  src,
  alt = "",
  size = "sm",
  className,
}: {
  src?: string | null;
  alt?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-hover text-subtle",
        size === "sm" ? "h-10 w-8" : "h-20 w-16",
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className={size === "sm" ? "size-3.5" : "size-5"} />
      )}
    </div>
  );
}

/** The standard first column of any product table: thumb, name, SKU. §6 */
export function ProductCell({
  name,
  sku,
  src,
  className,
}: {
  name: string;
  sku: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <Thumb src={src} alt={name} />
      <div className="min-w-0">
        <div className="truncate text-ink">{name}</div>
        <div className="text-meta uppercase tabular-nums text-muted-foreground">
          {sku}
        </div>
      </div>
    </div>
  );
}
