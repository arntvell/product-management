import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Origo buttons. See PRODUCT-MASTER-DESIGN.md §6 and §10:
// one primary action per view, labels are UPPERCASE verbs, no radius, no
// shadow, no bold. Case is applied here so call sites keep their sentence-case
// strings.
//
// Every shadcn variant and size name is kept — 53 files import this — and
// mapped onto a design-system appearance:
//   default → primary (ink)        outline → secondary (ink outline)
//   secondary → quiet fill         ghost → bare
//   destructive → secondary, per §9: a destructive action is a secondary
//     button whose confirmation carries the weight, not a loud red one
//   inverse → for use on ink (BulkBar)
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans text-meta uppercase transition-colors duration-150 ease-origo disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-offwhite hover:bg-ink/85 active:bg-ink/75",
        destructive: "border border-ink text-ink hover:bg-ink hover:text-offwhite",
        outline: "border border-ink text-ink hover:bg-ink hover:text-offwhite",
        secondary: "bg-hover text-ink hover:bg-selected",
        ghost: "text-ink hover:bg-hover active:bg-selected",
        inverse:
          "border border-offwhite text-offwhite hover:bg-offwhite hover:text-ink",
        link: "text-ink underline underline-offset-[3px] decoration-1 hover:decoration-cyan",
      },
      size: {
        // §5: controls are 40px, or 32px inside tables. `xs` stays for the
        // dense grid toolbars that already rely on it.
        default: "h-10 px-5",
        xs: "h-6 gap-1 px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3",
        lg: "h-10 px-6",
        icon: "size-10",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
