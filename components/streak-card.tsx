"use client";

import * as React from "react";
import Link from "next/link";
import { fmtVND } from "@/lib/format";
import {
  LEVERS,
  LEVER_LABELS,
  monthLong,
  monthShort,
  recentMonths,
  type Lever,
  type MonthKey,
  type MonthStatus,
  type Streak,
  type StreakMonth,
} from "@/lib/score";
import { PanelHead } from "@/components/panel-head";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A year of columns. Twelve because a saving habit is worth looking at over a year —
 *  shorter and a single good quarter reads as one. */
const SPAN = 12;

/** Plot height in px. Fixed rather than fluid: the columns are a fixed count, so the panel
 *  should be one height whatever the page is wide. */
const PLOT = 116;

/** Headroom above the tallest column, so a month that only just cleared the commitment
 *  doesn't touch the top of the plot and read as the maximum possible. */
const HEADROOM = 1.15;

/**
 * Each lever wears the hue of the page it came from — the same five-slot palette the nav
 * tints its sections with and `GoalStrip` fills its bars from. So a column says *where* the
 * month's money went before you read a single label, and it says it in the language the
 * rest of the app already uses: cyan is Investments here exactly as it is in the sidebar.
 */
const LEVER_COLOR: Record<Lever, string> = {
  invest: "var(--chart-3)",
  deposit: "var(--chart-4)",
  fund: "var(--chart-5)",
  debt: "var(--chart-2)",
};

const STATUS_WORD: Record<MonthStatus, string> = {
  met: "Met",
  carried: "Carried by the 3-month average",
  open: "In progress",
  missed: "Missed",
};

/** The gross of the positive levers — the denominator for a segment's share of the column,
 *  never its height. See `MonthColumn` for why those are different numbers. */
function gross(m: StreakMonth): number {
  return LEVERS.reduce((a, l) => a + Math.max(0, m.levers[l]), 0);
}

function MonthColumn({
  m,
  bar,
  zero,
  px,
  isNow,
  isOpen,
  onPick,
  onOpenChange,
}: {
  m: StreakMonth | null;
  bar: number;
  /** Baseline offset from the bottom of the plot, in px. */
  zero: number;
  /** ₫ → px on the plot's single scale. */
  px: (v: number) => number;
  isNow: boolean;
  isOpen: boolean;
  onPick: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  if (!m) {
    // Before you were tracking anything. There was no bar to fall short of, so this is not
    // a miss — it's absence, and it's drawn as nothing at all.
    return <div aria-hidden />;
  }

  const g = gross(m);
  const dim = m.status === "missed";
  const segments = LEVERS.filter((l) => m.levers[l] > 0);

  return (
    // The popup is *controlled*, which is the whole trick: left to its own devices a tooltip
    // opens on hover and focus, and a phone has neither to give — the columns were decoration
    // there, carrying a breakdown nothing could open. Driving `open` from the card's own state
    // means a tap opens the same popup a pointer does, on the same element, with no second
    // mobile-only layout to keep in step.
    <Tooltip open={isOpen} onOpenChange={onOpenChange}>
      <TooltipTrigger
        render={
          // A real button, not a focusable div: iOS gives a button focus and a click on tap,
          // and it's what makes the column announce itself and reach the keyboard.
          <button
            type="button"
            onClick={onPick}
            aria-label={`${monthLong(m.month)}: ${STATUS_WORD[m.status]}, ${fmtVND(m.total)} of ${fmtVND(bar)}`}
            className="relative rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ height: PLOT }}
          >
            {/* A channel behind the month in progress, and only that one — it marks "you are
                here" without adding a second scale for the eye to read the others against. */}
            {isNow && <span className="absolute inset-0 rounded-[4px] bg-secondary/55" aria-hidden />}

            {/* Colour is reserved for months that counted. A missed one keeps its hues — you
                still put that money somewhere — but drops back, so a run of good months is
                what the panel reads as from across the room. The column being explained comes
                fully forward whatever its status. */}
            <span
              className={cn(
                "absolute inset-0 transition-opacity",
                dim && !isOpen && "opacity-35",
                !dim && !isOpen && "opacity-90",
              )}
              aria-hidden
            >
              {m.total >= 0 ? (
                // **The column is the month's NET total**, because that is the figure the
                // commitment line judges. Segments then take their *share* of it from the
                // gross, so a month that also sold something shows where the money went while
                // still standing at the height it actually counts for. Drawing gross-up and
                // gross-down instead made a net-sell month cross the line it had not cleared.
                <span
                  className="absolute inset-x-0 flex flex-col-reverse overflow-hidden rounded-[4px]"
                  style={{ bottom: zero, height: px(m.total) }}
                >
                  {segments.map((l) => (
                    <span
                      key={l}
                      style={{ height: `${(m.levers[l] / g) * 100}%`, background: LEVER_COLOR[l] }}
                    />
                  ))}
                </span>
              ) : (
                // Sold more than you saved. Below the line, in the app's negative ink — the
                // same way the transactions chart draws a sell.
                <span
                  className="absolute inset-x-0 rounded-[4px]"
                  style={{ top: PLOT - zero, height: px(-m.total), background: "var(--chart-negative)" }}
                />
              )}
            </span>
          </button>
        }
      />
      <TooltipContent>
        <span className="block">
          <span className="block font-semibold">
            {monthLong(m.month)} · {STATUS_WORD[m.status]}
          </span>
          <span className="block font-mono tabular-nums">
            {fmtVND(m.total)} of {fmtVND(bar)}
          </span>
          {LEVERS.filter((l) => Math.round(m.levers[l]) !== 0).map((l) => (
            <span key={l} className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
              <span
                className="size-[7px] shrink-0 rounded-[2px]"
                style={{ background: m.levers[l] < 0 ? "var(--chart-negative)" : LEVER_COLOR[l] }}
              />
              {LEVER_LABELS[l]} {fmtVND(m.levers[l])}
            </span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The saving streak: how many consecutive months you cleared your own monthly commitment,
 * a year of them as stacked columns, and what this month still needs.
 *
 * Read-only and derived — see `lib/score.ts` for why none of it is stored.
 */
export function StreakCard({ streak }: { streak: Streak | null }) {
  // Which column's popup is open. `peek` is a pointer passing over (or keyboard focus) and
  // closes itself; `picked` is a tap, and sticks — on a phone that is the only way in, so it
  // has to survive the gesture that opened it. A pointer outranks a stale tap while it lasts.
  const [picked, setPicked] = React.useState<MonthKey | null>(null);
  const [peek, setPeek] = React.useState<MonthKey | null>(null);

  // No commitment, nothing to be on a streak of. The empty state is the instruction, which
  // is the honest version — a streak of zero would read as a failure you haven't had the
  // chance to have yet.
  if (!streak) {
    return (
      <div className="card-surface panel-body">
        <PanelHead
          title="Streak"
          info="Counts the months you cleared your own monthly commitment. It needs one first — a recurring rule, or a monthly plan on a goal."
        />
        <div className="mt-3 text-[13px] text-muted-foreground">
          Set a monthly commitment and this starts counting the months you clear it.
        </div>
        <div className="mt-2.5 flex gap-3 text-[12px]">
          <Link href="/recurring" className="text-accent-brand hover:underline">
            Recurring →
          </Link>
          <Link href="/goals" className="text-muted-foreground hover:text-foreground">
            Goals →
          </Link>
        </div>
      </div>
    );
  }

  const { now, current, best, shortfall, bar } = streak;
  const cells = recentMonths(streak, SPAN);
  const shown = cells.filter((c): c is StreakMonth => c !== null);

  // One scale for the whole plot, spanning the deepest sell-off to the biggest month, with
  // the commitment guaranteed a place on it. Drawn to a common scale rather than each column
  // to its own, because the comparison between months is the entire point.
  const ceiling = Math.max(bar * HEADROOM, ...shown.map((m) => Math.max(0, m.total)));
  const floor = Math.max(0, ...shown.map((m) => -m.total));
  const range = ceiling + floor || 1;
  const zero = (floor / range) * PLOT;
  const px = (v: number) => (v / range) * PLOT;

  // Only the levers this year actually used. A legend naming four when you used two is four
  // things to read and two of them are noise.
  const used = LEVERS.filter((l) => shown.some((m) => Math.round(m.levers[l]) !== 0));

  // Nothing is open until you point at something, exactly as before — the popup is the whole
  // interaction, so one open on load would be a popup nobody asked for.
  const open = peek ?? picked;

  return (
    <div className="card-surface panel-body">
      <PanelHead
        title="Streak"
        info={
          <>
            Consecutive months you put in at least your monthly commitment — money in, new
            deposits, cash set aside, and repayments beyond what the schedule required.
            Market movement is excluded, so a good month for prices is not a month you saved.
            A short month still counts if the 3-month average clears the bar.
          </>
        }
        actions={
          best > current ? (
            <Badge variant="secondary" className="font-mono tabular-nums">
              Best {best}
            </Badge>
          ) : null
        }
      />

      {/* The figure and the plot side by side on a wide column, stacking on a narrow one.
          Content-driven like the rest of the dashboard — what decides it is this panel's own
          width, not the window's. */}
      <div className="mt-4 flex flex-wrap items-start gap-x-7 gap-y-5">
        <div className="min-w-0 flex-[1_1_180px]">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
              {current}
            </span>
            <span className="text-[13px] text-muted-foreground">
              {current === 1 ? "month" : "months"} in a row
            </span>
          </div>

          {/* The shortfall, never a countdown. "Your streak dies in 3 days" is loss aversion
              aimed at a financial decision; a number you still need is the same fact and is
              something you can act on well. */}
          <div
            className={cn(
              "mt-2 text-[12.5px]",
              shortfall > 0 ? "text-muted-foreground" : "text-accent-brand",
            )}
          >
            {shortfall > 0 ? (
              <>
                {fmtVND(shortfall)} more makes {monthShort(now.month)}
              </>
            ) : now.status === "carried" ? (
              // It counts, but not on its own figure — and a month that reads "in" while
              // sitting visibly below the line has to say what is holding it up.
              <>{monthShort(now.month)} is in on the 3-month average</>
            ) : (
              <>
                {monthShort(now.month)} is in · {fmtVND(now.total)} so far
              </>
            )}
          </div>

          <div className="mt-3.5 border-t border-divider pt-3 font-mono text-[11px] text-faint">
            {fmtVND(bar)}/month ·{" "}
            {streak.barSource === "recurring" ? "your recurring rules" : "your goal plans"}
          </div>

          {used.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5">
              {used.map((l) => (
                <span key={l} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <span className="size-[9px] rounded-[2px]" style={{ background: LEVER_COLOR[l] }} />
                  {LEVER_LABELS[l]}
                </span>
              ))}
              {/* The dashed rule, named. It used to carry its own figure at the end of the
                  line, which landed on top of the newest column — and the figure is already
                  spelled out two lines above this. */}
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span className="w-3.5 border-t border-dashed border-muted-foreground/70" />
                Commitment
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-[2_1_320px]">
          <div className="relative" style={{ height: PLOT }}>
            {/* The commitment. A dashed rule rather than a coloured band: it's the line the
                columns are measured against, not a region of its own. */}
            <div
              className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-muted-foreground/45"
              style={{ bottom: zero + px(bar) }}
              aria-hidden
            />
            {/* Only drawn when something actually went below it — an axis for a value no
                month reached is a line explaining nothing. */}
            {floor > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-divider"
                style={{ bottom: zero }}
                aria-hidden
              />
            )}
            <div className="grid h-full grid-cols-12 items-end gap-1 sm:gap-1.5">
              {cells.map((m, i) => (
                <MonthColumn
                  key={m?.month ?? `pad-${i}`}
                  m={m}
                  zero={zero}
                  px={px}
                  isNow={m?.month === now.month}
                  bar={bar}
                  isOpen={m?.month === open}
                  // A second tap on the same column closes it — on touch there is no "pointer
                  // away", so without this a popup could only ever be swapped, never dismissed.
                  onPick={() => m && setPicked((p) => (p === m.month ? null : m.month))}
                  onOpenChange={(o) => {
                    if (!m) return;
                    if (o) setPeek(m.month);
                    // Covers the pointer leaving *and* a press outside the popup, which is how
                    // a tap-opened one gets dismissed.
                    else {
                      setPeek((prev) => (prev === m.month ? null : prev));
                      setPicked((prev) => (prev === m.month ? null : prev));
                    }
                  }}
                />
              ))}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-12 gap-1 sm:gap-1.5">
            {cells.map((m, i) => (
              <span
                key={m?.month ?? `lab-${i}`}
                className={cn(
                  "truncate text-center font-mono text-[9.5px]",
                  m?.month === open
                    ? "font-semibold text-foreground"
                    : m?.month === now.month
                      ? "text-muted-foreground"
                      : "text-faint",
                )}
              >
                {m ? monthShort(m.month) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
