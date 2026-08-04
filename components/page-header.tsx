import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The row every page opens with, from the design: a 30px title, a single line of secondary
 * ink explaining what the page is for, and the page's own actions pushed to the right edge.
 *
 * One component rather than a hand-rolled block per page — when they were hand-rolled the
 * five drifted (26px here, 24px there, and the subtitle capped at a different measure on
 * each). The actions slot is what pulls the primary button up out of the panels below,
 * which is where the design puts it.
 */
export function PageHeader({
  title,
  children,
  actions,
  className,
}: {
  title: React.ReactNode;
  /** The subtitle. Capped at ~76 characters' worth of measure — past that a single line of
   *  secondary ink stops being scannable and starts being a paragraph. */
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-5 gap-y-3.5",
        className,
      )}
    >
      {/* `basis-[min(100%,32rem)]` is what makes the row responsive without a breakpoint:
          the title claims a full line as soon as the two blocks can't share one, which
          drops the actions onto their own row instead of squeezing them off the edge. */}
      <div className="min-w-0 flex-1 basis-[min(100%,32rem)]">
        <h1 className="text-[24px] font-bold tracking-[-0.025em] sm:text-[30px]">{title}</h1>
        {children && (
          <div className="mt-1.5 max-w-[760px] text-[13.5px] text-muted-foreground">
            {children}
          </div>
        )}
      </div>
      {/* `ml-auto` and not just `justify-between`: once the actions drop to their own line
          space-between alone would strand them at the left margin under the title. No
          `shrink-0` — that would pin the group at max-content and push the last button off
          a phone rather than letting this row's own `flex-wrap` break it. */}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
