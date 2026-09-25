"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CheckIcon, InfoIcon, TriangleAlertIcon, XIcon, Loader2Icon } from "lucide-react"

/** The Wise toast: a white card with the float shadow, and the tone carried only by a
 *  32px disc holding the icon. The message itself stays in plain ink, so a toast reads as
 *  a sentence rather than a coloured alert. */
function Disc({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`grid size-8 shrink-0 place-items-center rounded-full ${className}`}>
      {children}
    </span>
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <Disc className="bg-accent text-accent-foreground"><CheckIcon className="size-[18px]" /></Disc>
        ),
        info: (
          <Disc className="bg-pane text-foreground"><InfoIcon className="size-[18px]" /></Disc>
        ),
        warning: (
          <Disc className="bg-warning-bg text-warning"><TriangleAlertIcon className="size-[18px]" /></Disc>
        ),
        error: (
          <Disc className="bg-negative-wash-strong text-destructive"><XIcon className="size-[18px]" /></Disc>
        ),
        loading: (
          <Disc className="bg-pane text-foreground"><Loader2Icon className="size-[18px] animate-spin" /></Disc>
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--card-edge)",
          "--border-radius": "24px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast gap-3! px-4! py-3! text-body! shadow-(--menu-shadow)!",
          icon: "size-8! m-0!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
