import * as React from "react";
import Link from "next/link";
import { fmtVND } from "@/lib/format";
import { GOAL_METRIC_LABELS, type GoalMetric } from "@/lib/types";
import { STATUS_LABELS, verdict, type GoalStatus, type GoalView } from "@/lib/goals";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Chip tones reuse the net-worth pill's language: green = fine, rust = not.
 *  `stalled` deliberately stays neutral — "No pace" means you never set a monthly
 *  commitment, not that you're failing one. Painting it the same coral as `behind`
 *  flagged every unplanned goal as a problem and drained the colour of its meaning. */
const STATUS_TONE: Record<GoalStatus, "accent" | "destructive" | "secondary"> = {
  hit: "accent",
  on_track: "accent",
  behind: "destructive",
  stalled: "secondary",
  open: "secondary",
};

/** The bar's fill takes the colour of the thing it tracks — the same hue that section wears
 *  in the rail, so a row of goals reads as which parts of your money they're about before
 *  you read a single label. A stalled goal drops to the disabled grey instead. */
const METRIC_FILL: Record<GoalMetric, string> = {
  net_worth: "var(--chart-1)",
  investments: "var(--chart-3)",
  savings: "var(--chart-4)",
  debts: "var(--chart-2)",
  fund: "var(--chart-5)",
};

/** The channel is empty glass; `.goal-fill` (see globals.css) is the liquid in it — it pours
 *  out to the target on load, then keeps a crest of light moving through. */
export function GoalBar({
  progress,
  muted,
  metric,
}: {
  progress: number;
  muted?: boolean;
  metric?: GoalMetric;
}) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("goal-fill h-full rounded-full", muted && "goal-fill-muted")}
        style={
          {
            width: `${Math.round(progress * 100)}%`,
            // `goal-fill-muted` sets the same custom property in CSS, so it has to win —
            // hence only setting it here when the goal isn't muted.
            ...(metric && !muted ? { "--goal-fill-color": METRIC_FILL[metric] } : {}),
          } as React.CSSProperties
        }
      />
    </div>
  );
}

/** The metric tag, tinted to match the bar below it. Same hue, two places — the tag names
 *  the thing and the bar measures it, so painting them apart would be a wasted signal. */
export function GoalMetricTag({ metric, className }: { metric: GoalMetric; className?: string }) {
  const c = METRIC_FILL[metric];
  return (
    <Badge
      variant="tag"
      className={className}
      style={{
        background: `color-mix(in oklch, ${c} 15%, transparent)`,
        color: `color-mix(in oklch, ${c} 78%, var(--foreground))`,
      }}
    >
      {GOAL_METRIC_LABELS[metric]}
    </Badge>
  );
}

export function GoalStatusChip({ status, className }: { status: GoalStatus; className?: string }) {
  return (
    <Badge variant={STATUS_TONE[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** The dashboard's goals rail: one row per active goal, sitting under the net-worth hero.
 *  Read-only — the row links through to `/goals`, where they're actually managed. */
export function GoalStrip({ goals }: { goals: GoalView[] }) {
  if (goals.length === 0) return null;

  return (
    // A container query, not a viewport one: the strip used to span the page and now sits
    // in the dashboard's analysis column, so what decides whether a goal fits on one line is
    // this panel's own width — not the window's.
    <div className="@container card-surface">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <span className="text-[16px] font-bold tracking-[-0.01em]">Goals</span>
        <Link href="/goals" className="text-[12px] text-muted-foreground hover:text-foreground">
          Manage →
        </Link>
      </div>
      <div>
        {goals.map(({ goal, proj }, i) => (
          <Link
            key={goal.id}
            href="/goals"
            className="flex flex-col gap-2 border-t border-divider px-5 py-3.5 transition-colors hover:bg-muted/40 @2xl:flex-row @2xl:items-center @2xl:gap-5"
          >
            <div className="flex min-w-0 items-center gap-2 @2xl:w-[34%]">
              {/* The rank you set on /goals — the rail is ordered by it, so showing the
                  number is what makes that order legible rather than arbitrary. */}
              <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">{i + 1}</span>
              <span className="truncate text-[13.5px] font-medium">{goal.name}</span>
              {/* First thing to go when the row gets tight: the bar below already carries
                  this goal's metric as its colour, so the tag is the redundant copy. */}
              <GoalMetricTag metric={goal.metric} className="hidden @3xl:inline-flex" />
            </div>

            <div className="flex flex-1 items-center gap-3">
              <GoalBar progress={proj.progress} muted={proj.status === "stalled"} metric={goal.metric} />
              <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
                {Math.round(proj.progress * 100)}%
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 @2xl:justify-end">
              <span className="font-mono text-[12px] tabular-nums">
                {fmtVND(proj.current)}{" "}
                <span className="text-faint">/ {fmtVND(goal.target)}</span>
              </span>
              <GoalStatusChip status={proj.status} />
            </div>
          </Link>
        ))}
      </div>
      <div className="border-t border-divider px-5 py-2.5 font-mono text-[11px] text-faint">
        {goals.length === 1
          ? verdict(goals[0].goal, goals[0].proj)
          : "Projected at your committed pace · market growth counted as zero"}
      </div>
    </div>
  );
}
