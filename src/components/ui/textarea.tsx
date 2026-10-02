import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-line bg-paper text-ink placeholder:text-subtle flex field-sizing-content min-h-16 w-full border px-3 py-2.5 text-body transition-colors duration-150 ease-origo",
        "hover:border-muted-foreground focus-visible:border-ink",
        "disabled:cursor-not-allowed disabled:bg-hover disabled:text-subtle",
        "aria-invalid:border-ink",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
