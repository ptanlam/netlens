import Link from "next/link";
import { fmtVND } from "@/lib/format";
import { GOAL_METRIC_LABELS } from "@/lib/types";
import { STATUS_LABELS, verdict, type GoalStatus, type GoalView } from "@/lib/goals";
import { cn } from "@/lib/utils";

/** Chip tones reuse the net-worth pill's language: green = fine, rust = not. */
const STATUS_TONE: Record<GoalStatus, string> = {
  hit: "bg-accent text-accent-brand",
  on_track: "bg-accent text-accent-brand",
  behind: "bg-negative-wash-strong text-(--chart-negative)",
  stalled: "bg-negative-wash-strong text-(--chart-negative)",
  open: "bg-secondary text-muted-foreground",
};

export function GoalBar({ progress, muted }: { progress: number; muted?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full", muted ? "bg-disabled-foreground" : "bg-accent-brand")}
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
    </div>
  );
}

export function GoalStatusChip({ status, className }: { status: GoalStatus; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-2 py-[3px] font-mono text-[11px] whitespace-nowrap tabular-nums",
        STATUS_TONE[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** The dashboard's goals rail: one row per active goal, sitting under the net-worth hero.
 *  Read-only — the row links through to `/goals`, where they're actually managed. */
export function GoalStrip({ goals }: { goals: GoalView[] }) {
  if (goals.length === 0) return null;

  return (
    <div className="mt-[26px] rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-faint uppercase">Goals</span>
        <Link href="/goals" className="text-[12px] text-muted-foreground hover:text-foreground">
          Manage →
        </Link>
      </div>
      <div>
        {goals.map(({ goal, proj }) => (
          <Link
            key={goal.id}
            href="/goals"
            className="flex flex-col gap-2 border-t border-divider px-5 py-3.5 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-5"
          >
            <div className="flex min-w-0 items-center gap-2 sm:w-[30%]">
              <span className="truncate text-[13.5px] font-medium">{goal.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-faint uppercase">
                {GOAL_METRIC_LABELS[goal.metric]}
              </span>
            </div>

            <div className="flex flex-1 items-center gap-3">
              <GoalBar progress={proj.progress} muted={proj.status === "stalled"} />
              <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
                {Math.round(proj.progress * 100)}%
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 sm:justify-end">
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
