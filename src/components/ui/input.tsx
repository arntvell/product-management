import * as React from "react"

import { cn } from "@/lib/utils"

// §6: paper ground, hairline border that goes ink on hover and focus, no
// radius, no shadow. Placeholders are the only place `subtle` is allowed.
// Height is the §5 control height; pass `h-8` for the 32px variant in tables.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-line bg-paper text-ink placeholder:text-subtle h-10 w-full min-w-0 border px-3 text-body transition-colors duration-150 ease-origo",
        "hover:border-muted-foreground focus-visible:border-ink",
        "file:text-ink file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-body",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-hover disabled:text-subtle",
        // Invalid is ink, not colour. §3
        "aria-invalid:border-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input }
