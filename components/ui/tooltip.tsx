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
      {/* `z-50` belongs on the *Positioner*, not the popup: that's the element Base UI
          gives `position: fixed`, so it's the one that takes part in the page's stacking
          order. With the z-index only on the popup inside, the positioner sat at `auto`
          and `<main class="relative z-10">` painted over every tooltip in the app. */}
      <TooltipPrimitive.Positioner sideOffset={sideOffset} side={side} className="isolate z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip"
          className={cn(
            // Wrapped, not one long line: these carry a sentence explaining a panel now,
            // and unconstrained they stretched half the width of the screen.
            "max-w-[min(22rem,calc(100vw-2rem))] text-balance select-none rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-md",
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
