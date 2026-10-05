import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// §6: a neutral metadata tag — season, category, channel. It carries a fact,
// never a status; status is StatusBadge, which speaks in shape and word.
//
// The existing variant names map onto the system's three: solid, outline,
// quiet. Square, 24px tall, meta caps.
const badgeVariants = cva(
  "inline-flex h-6 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-meta uppercase w-fit shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none overflow-hidden transition-colors duration-150 ease-origo",
  {
    variants: {
      variant: {
        default: "bg-ink text-offwhite [a&]:hover:bg-ink/85",
        secondary: "bg-hover text-muted-foreground [a&]:hover:bg-selected",
        // The one badge that must be the loudest thing on screen. §3
        destructive: "bg-ink text-offwhite [a&]:hover:bg-ink/85",
        outline: "border border-line text-ink [a&]:hover:bg-hover",
        ghost: "text-muted-foreground [a&]:hover:bg-hover",
        link: "text-ink underline underline-offset-[3px] decoration-1 [a&]:hover:decoration-cyan",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
