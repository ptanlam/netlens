import { cn } from "@/lib/utils";

/**
 * The design's row mark: a small tinted circle carrying the name's first letter, sitting
 * left of every holding in a list.
 *
 * The tint is the asset type's own colour rather than one hashed from the name, so the
 * circle repeats information the eye can already use — a column of these reads as the
 * allocation split, the same slots the donut and the bars use. A name with no type falls
 * back to the neutral surface.
 */
export function EntityAvatar({
  name,
  color,
  size = "md",
  className,
}: {
  name: string;
  /** A CSS colour — pass `typeColor(assetType)`. Omit for the neutral tile. */
  color?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold",
        size === "sm" ? "size-[22px] text-[10px]" : "size-6 text-[10px]",
        color ? "" : "bg-pane text-muted-foreground",
        className,
      )}
      // `color-mix` rather than two hardcoded values: the fill is the type colour at low
      // alpha and the letter is the same hue lifted toward the page ink, so one token
      // drives both and the pair stays legible when the theme flips.
      style={
        color
          ? {
              background: `color-mix(in oklch, ${color} 18%, transparent)`,
              color: `color-mix(in oklch, ${color} 72%, var(--foreground))`,
            }
          : undefined
      }
    >
      {initial}
    </span>
  );
}
