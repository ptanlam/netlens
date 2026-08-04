"use client";

import * as React from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The design's panel header: the title, a small outlined "i" beside it, and the panel's own
 * controls pushed to the right edge.
 *
 * The "i" is a real tooltip, not decoration. The design draws one on every panel, and the
 * app already had the explanatory sentence for most of them sitting under the title as a
 * permanent second line — this is the same sentence, on demand, which is what lets the
 * header stay one line deep the way the design's does.
 *
 * `tone="label"` is the quieter variant the design uses on the small rail cards ("Net worth"
 * at 13px in secondary ink) rather than the 16px panel title.
 */
export function PanelHead({
  title,
  info,
  tone = "title",
  actions,
  className,
}: {
  title: React.ReactNode;
  /** Tooltip text for the "i". Omit it and no dot is drawn — an empty tooltip is worse
   *  than no affordance. */
  info?: React.ReactNode;
  tone?: "title" | "label";
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "truncate",
            tone === "title"
              ? "text-[16px] font-bold tracking-[-0.01em]"
              : "text-[13px] text-muted-foreground",
          )}
        >
          {title}
        </span>
        {info && (
          <IconTooltip label={info}>
            <button
              type="button"
              // `cursor-help`, and it takes focus: the tooltip is the only place this
              // explanation now lives, so it has to be reachable without a pointer.
              aria-label={`About ${typeof title === "string" ? title : "this panel"}`}
              className="grid size-[15px] shrink-0 cursor-help place-items-center rounded-full border border-input text-[9.5px] leading-none font-normal text-faint transition-colors hover:border-muted-foreground hover:text-muted-foreground"
            >
              i
            </button>
          </IconTooltip>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  );
}
