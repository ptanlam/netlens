import * as React from "react";

/**
 * The rendered width of an element, in CSS pixels.
 *
 * For charts that would otherwise be drawn in a fixed-width viewBox and stretched to fit
 * (`preserveAspectRatio="none"`). That stretch scales x and y by different factors, so a
 * step in the line gets smeared sideways and picks up visibly more weight than the flat
 * runs either side of it. Drawing in real pixels keeps one unit meaning the same thing on
 * both axes.
 *
 * Returns 0 until the first measurement lands — draw nothing (or a baseline) until then.
 * The width is only ever set from the ResizeObserver callback, never straight out of the
 * effect, which is both correct (it fires once on observe) and what keeps the React
 * Compiler's `set-state-in-effect` rule happy.
 */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      setWidth((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}
