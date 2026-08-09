"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `iso` shifted by whole months, clamped to the target month's last day.
 *
 * The clamp matters at month ends: plain date arithmetic turns "31 March, minus one month"
 * into 3 March, because 31 February rolls forward — so a 1M range would quietly reach three
 * days further back than it claims.
 */
export function shiftMonths(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(y, m - 1 + delta, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const dt = new Date(first.getFullYear(), first.getMonth(), Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** How far back every panel opens on. A year is the shortest window that shows a full
 *  seasonal cycle — an annual subscription renewal, a maturing deposit, a January dip —
 *  while still being short enough that this month is legible inside it. */
export const DEFAULT_RANGE_MONTHS = 12;

/**
 * The window a panel opens on: the last year, or all of it when there's less than a year of
 * data. Shared rather than seeded per panel — the three callers each had their own idea of
 * the default and had already drifted apart (two on YTD, one on All).
 *
 * The clamp is what makes the pills honest: on a series younger than a year `from` lands on
 * `min`, so the pill that reads as active is "All", which is what you're actually looking
 * at. Empty in, empty out — the dashboard's series is fetched after mount, and there is no
 * window to compute before it arrives.
 */
export function defaultWindow(min: string, max: string): { from: string; to: string } {
  const anchor = max || min;
  if (!anchor) return { from: min, to: max };
  const year = shiftMonths(anchor, -DEFAULT_RANGE_MONTHS);
  return { from: year > min ? year : min, to: max };
}

/**
 * The date-window control every "over time" panel wears: five presets, then the two dates
 * spelled out so a window that isn't one of them can still be dialled in.
 *
 * One component rather than a copy per panel — it was hand-rolled three times over and the
 * copies had already drifted (different pill tracks, and only some of them anchoring the
 * presets to the newest data rather than to today).
 *
 * `max` is the anchor: presets count back from the newest point the caller actually has, so
 * on a series that stops last week "1M" still frames a month of data instead of a month
 * that's mostly empty. A preset reads as active only when `to` is still parked on it.
 */
export function DateRange({
  from,
  to,
  min,
  max,
  onChange,
  className,
}: {
  from: string;
  to: string;
  /** Oldest selectable date — what "All" reaches back to. */
  min: string;
  /** Newest selectable date; the anchor every preset counts back from. */
  max: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}) {
  const anchor = max || min;
  const presets = React.useMemo(
    () => [
      { label: "1M", from: shiftMonths(anchor, -1) },
      { label: "3M", from: shiftMonths(anchor, -3) },
      // YTD sits before 1Y despite reaching back further in December: the row is ordered
      // the way every finance chart orders it, not by the span each happens to cover today.
      { label: "YTD", from: `${anchor.slice(0, 4)}-01-01` },
      { label: "1Y", from: shiftMonths(anchor, -DEFAULT_RANGE_MONTHS) },
      { label: "All", from: min },
    ],
    [anchor, min],
  );

  // Fixed height, not padding: a date field derives a different intrinsic height from the
  // same padding as the pills it sits beside.
  const field =
    "h-7 rounded-lg border border-input bg-pane px-2.5 font-mono text-[12px] outline-none focus:border-ring";

  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className={cn(
              "cursor-pointer rounded-full border-0 px-3 py-[5px] text-[12px] font-semibold transition-colors",
              from === p.from && to === max
                ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(p.from, max)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* Each field bounds the other, so the window can't be inverted; and an empty value —
          what you get mid-edit, or from the picker's clear button — is ignored rather than
          collapsing the range to nothing while you type. */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          min={min}
          max={to}
          aria-label="From date"
          onChange={(e) => { if (e.target.value) onChange(e.target.value, to); }}
          className={field}
        />
        <span className="text-faint">–</span>
        <input
          type="date"
          value={to}
          min={from}
          max={max}
          aria-label="To date"
          onChange={(e) => { if (e.target.value) onChange(from, e.target.value); }}
          className={field}
        />
      </div>
    </div>
  );
}
