import { cn } from "@/lib/utils";

/**
 * The design's row mark: a small circle sitting left of every holding in a list.
 *
 * With a `logo` (see `lib/logos.ts`) it's the real brand mark on a paper chip — the
 * marks are drawn for light backgrounds, so the chip stays white in both themes and a
 * hairline keeps it off the card.
 *
 * Without one it falls back to the name's first letter, tinted with the asset type's
 * own colour rather than one hashed from the name, so the circle repeats information
 * the eye can already use — a column of these reads as the allocation split, the same
 * slots the donut and the bars use. A name with no type falls back to the neutral tile.
 */
export function EntityAvatar({
  name,
  color,
  logo,
  size = "md",
  className,
}: {
  name: string;
  /** A CSS colour — pass `typeColor(assetType)`. Omit for the neutral tile. */
  color?: string;
  /** A bundled brand mark — pass `holdingLogo(name, symbol)`. Omit for the letter. */
  logo?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = cn(
    "grid shrink-0 place-items-center rounded-full",
    size === "sm" && "size-[22px]",
    size === "md" && "size-6",
    size === "lg" && "size-7",
  );

  if (logo) {
    return (
      <span aria-hidden className={cn(box, "overflow-hidden border border-divider bg-white", className)}>
        {/* A plain <img>: these are pre-sized 96px PNGs served straight off the Worker's
            static assets, so `next/image` would only add a resize round trip. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" className="size-full object-contain p-[2px]" />
      </span>
    );
  }

  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        box,
        "font-bold",
        size === "sm" && "text-[10px]",
        size === "md" && "text-[10px]",
        size === "lg" && "text-[11px]",
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
