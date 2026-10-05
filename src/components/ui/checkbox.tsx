"use client"

import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// §6: square, ink border, ink fill when checked. `indeterminate` shows a minus
// — it is what the select-all header cell uses.
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-ink bg-paper size-4 shrink-0 border transition-colors duration-150 ease-origo",
        "data-[state=checked]:bg-ink data-[state=checked]:text-offwhite",
        "data-[state=indeterminate]:bg-ink data-[state=indeterminate]:text-offwhite",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "aria-invalid:border-ink",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {props.checked === "indeterminate" ? (
          <MinusIcon className="size-3" />
        ) : (
          <CheckIcon className="size-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
