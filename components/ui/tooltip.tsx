"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & { sideOffset?: number; side?: TooltipPrimitive.Positioner.Props["side"] }) {
  const { side, ...popupProps } = props
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset} side={side}>
        <TooltipPrimitive.Popup
          data-slot="tooltip"
          className={cn(
            "z-50 select-none rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md",
            "origin-[var(--transform-origin)] transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
          {...popupProps}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/**
 * Wraps a single button/element with a hover- and focus-triggered tooltip. Pass the
 * button as the only child; its own props (onClick, render, children) are preserved.
 * Not breakpoint-gated — shows on desktop and, via focus, on touch too.
 */
function IconTooltip({
  label,
  side,
  children,
}: {
  label: React.ReactNode
  side?: TooltipPrimitive.Positioner.Props["side"]
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, IconTooltip }
