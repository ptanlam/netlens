"use client";

import { Eye, EyeOff } from "lucide-react";
import { IconTooltip } from "@/components/ui/tooltip";
import { setMasked, useMasked } from "@/lib/mask";
import { cn } from "@/lib/utils";

/** The design's eye button: hides every amount in the app, for a screen someone else can
 *  see. Styled as one of the header's round affordances, like the theme picker beside it. */
export function MaskToggle({ className }: { className?: string }) {
  const masked = useMasked();
  const label = masked ? "Show amounts" : "Hide amounts";
  return (
    <IconTooltip label={label}>
      <button
        type="button"
        onClick={() => setMasked(!masked)}
        aria-label={label}
        aria-pressed={masked}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full border border-input bg-card text-muted-foreground transition-colors duration-[120ms] hover:bg-pane hover:text-foreground aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:text-primary-foreground",
          className,
        )}
      >
        {masked ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </IconTooltip>
  );
}
