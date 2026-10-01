"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Toasts report asynchronous outcomes that land after you have moved on —
// a channel push finishing, an import completing. Work you are watching happen
// confirms itself inline instead; see the feedback policy in
// docs/origo-design-system-adoption.md.
//
// Light only, so there is no theme to read. This was the last place
// next-themes was imported.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--paper)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
          "--border-radius": "0",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
