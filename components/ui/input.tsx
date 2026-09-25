import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-field-border bg-card px-3.5 py-1 text-body transition-[border-color,box-shadow] duration-[120ms] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body-sm file:font-semibold file:text-foreground placeholder:text-faint hover:border-foreground focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-pane disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive md:text-body-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
