import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The dark hover card the hand-rolled line charts share (portfolio value, savings/debt
 * value over time, capital deployed).
 *
 * It parks itself in whichever half of the plot the hovered point *isn't* in. Pinned to the
 * top — which is what all three did — it sat straight over the series on any chart that
 * trends upward, and every chart here worth reading trends upward: you'd point at a peak
 * and the card would cover the very line you were pointing at.
 *
 * The switch is on the *highest* marker rather than the pointer, so on a two-line chart
 * both dots stay clear of it; 0.55 rather than 0.5 so a series hugging the middle settles
 * downward instead of flickering between the two positions as you track along it.
 */
export function ChartTip({
  leftPct,
  topFrac,
  children,
}: {
  /** Horizontal anchor, 0–100, already clamped to keep the card inside the plot. */
  leftPct: number;
  /** The highest plotted marker's y as a fraction of plot height (0 = top edge). */
  topFrac: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-10 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 whitespace-nowrap",
        topFrac < 0.55 ? "bottom-1.5" : "top-1.5",
      )}
      style={{ left: `${leftPct}%` }}
    >
      {children}
    </div>
  );
}
